import express from 'express';
import { randomBytes } from 'crypto';
import { bearerToken, createSession, deleteSession, requireSession, verifyGoogleIdToken } from './auth';
import { query, transaction } from './db';
import * as razorpay from './razorpay';

const app = express();

const PORT = Number(process.env.PORT ?? 8080);
const RUPEE = 100;
/** ₹1 for a 1-day trial, then ₹199 every 30 days (the Razorpay plan's period). */
const PRICING = { trialPaise: 1 * RUPEE, renewalPaise: 199 * RUPEE, trialDays: 1 };
/** 30-day debits the mandate covers: about five years, then the user re-subscribes. */
const SUBSCRIPTION_CYCLES = 60;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;

// Razorpay calls this, not the app, so it authenticates by signature rather
// than the bearer token. It needs the raw body for that, so it is registered
// before the JSON parser.
app.post('/webhooks/razorpay', express.raw({ type: '*/*' }), async (req, res) => {
  const body = req.body as Buffer;
  if (!razorpay.webhookSignatureValid(body, req.header('x-razorpay-signature') ?? '')) {
    res.status(400).send('Bad signature');
    return;
  }
  try {
    await handleRazorpayEvent(JSON.parse(body.toString('utf8')));
    res.json({ ok: true });
  } catch (error) {
    // A non-2xx makes Razorpay retry, and every handler below is idempotent.
    console.error('[razorpay webhook]', req.header('x-razorpay-event-id'), error);
    res.status(500).send('Failed');
  }
});

app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- auth

app.post('/auth/google', async (req, res) => {
  let identity;
  try {
    identity = await verifyGoogleIdToken(String(req.body?.idToken ?? ''));
  } catch (error) {
    console.warn('[auth/google]', (error as Error).message);
    res.status(401).send('Google sign-in could not be verified.');
    return;
  }

  // Registration is implicit: a verified Google account is a user.
  const now = iso();
  const [user] = await query<{ id: string; email: string | null; name: string | null }>(
    `INSERT INTO users (id, google_sub, email, name, created_at, last_seen_at, app_version, device_model)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
     ON CONFLICT (google_sub) WHERE google_sub IS NOT NULL DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           last_seen_at = EXCLUDED.last_seen_at,
           app_version = EXCLUDED.app_version,
           device_model = EXCLUDED.device_model
     RETURNING id, email, name;`,
    [
      newId('usr'),
      identity.sub,
      identity.email,
      identity.name,
      now,
      String(req.body?.appVersion ?? ''),
      String(req.body?.deviceModel ?? ''),
    ],
  );

  const token = await createSession(user.id);
  res.json({ uid: user.id, email: user.email, name: user.name, token });
});

// Everything below acts on the signed-in user, and only that user.
app.use(requireSession);

app.post('/auth/signOut', async (req, res) => {
  await deleteSession(bearerToken(req));
  res.json({ ok: true });
});

// ------------------------------------------------------- subscriptions

app.post('/startSubscription', async (req, res) => {
  const uid = res.locals.uid as string;
  if (razorpay.razorpayConfigured) {
    await startRazorpaySubscription(uid, res);
    return;
  }

  // No gateway configured: grant the trial straight away, as the app's local
  // stub does.
  const now = iso();
  const validUntil = iso(Date.now() + PRICING.trialDays * 86_400_000);

  try {
    const subscription = await transaction(async (q) => {
      // The partial unique index permits one live subscription per user.
      await q(
        `UPDATE subscriptions SET status = 'expired'
         WHERE user_id = $1 AND status IN ('trial','active','cancelled');`,
        [uid],
      );
      const [sub] = await q<{ id: string; valid_until: string }>(
        `INSERT INTO subscriptions
           (id, user_id, plan, status, trial_price, price, currency,
            provider, mandate_id, started_at, valid_until, cancelled_at)
         VALUES ($1, $2, 'monthly_premium', 'trial', $3, $4, 'INR',
                 NULL, NULL, $5, $6, NULL)
         RETURNING id, valid_until;`,
        [newId('sub'), uid, PRICING.trialPaise, PRICING.renewalPaise, now, validUntil],
      );
      await q(
        `INSERT INTO payments
           (id, user_id, subscription_id, amount, currency, type, status,
            provider, provider_txn_id, created_at)
         VALUES ($1, $2, $3, $4, 'INR', 'trial', 'simulated', NULL, NULL, $5);`,
        [newId('pay'), uid, sub.id, PRICING.trialPaise, now],
      );
      return sub;
    });
    res.json({ status: 'trial', validUntil: subscription.valid_until, provider: null });
  } catch (error) {
    res.status(400).send((error as Error).message);
  }
});

/**
 * Creates the Razorpay subscription and hands its id to the app for Checkout.
 * Nothing is written here: the row is created once the payment is proven, by
 * /verifySubscription or the subscription.authenticated webhook, whichever
 * arrives first.
 */
async function startRazorpaySubscription(uid: string, res: express.Response): Promise<void> {
  const [user] = await query<{ email: string | null }>('SELECT email FROM users WHERE id = $1;', [uid]);
  if (!user) {
    res.status(404).send('Unknown user.');
    return;
  }
  // A second subscription would mean a second mandate debiting the same person.
  const [live] = await query(
    `SELECT id FROM subscriptions
     WHERE user_id = $1 AND status IN ('trial','active') AND valid_until > $2;`,
    [uid, iso()],
  );
  if (live) {
    res.status(409).send('You already have Premium.');
    return;
  }
  try {
    const sub = await razorpay.createSubscription({
      uid,
      trialDays: PRICING.trialDays,
      trialPaise: PRICING.trialPaise,
      totalCount: SUBSCRIPTION_CYCLES,
    });
    res.json({
      checkout: { keyId: razorpay.razorpayKeyId, subscriptionId: sub.id, email: user.email },
    });
  } catch (error) {
    console.error('[razorpay create]', error);
    res.status(502).send('Could not start the payment. Try again.');
  }
}

/** Called by the app with Checkout's success response. */
app.post('/verifySubscription', async (req, res) => {
  const uid = res.locals.uid as string;
  const paymentId = String(req.body?.paymentId ?? '');
  const subscriptionId = String(req.body?.subscriptionId ?? '');
  const signature = String(req.body?.signature ?? '');

  let sub: razorpay.RzpSubscription;
  try {
    // Fetched rather than trusted from the client, so the signature is checked
    // against an id Razorpay confirms belongs to this user.
    sub = await razorpay.fetchSubscription(subscriptionId);
  } catch {
    res.status(400).send('Unknown subscription.');
    return;
  }
  if (razorpay.ownerOf(sub) !== uid) {
    res.status(403).send('That subscription belongs to someone else.');
    return;
  }
  if (!razorpay.checkoutSignatureValid(paymentId, sub.id, signature)) {
    res.status(400).send('Payment could not be verified.');
    return;
  }
  res.json(await activateTrial(uid, sub, paymentId));
});

/**
 * Turns an authorised Razorpay subscription into a trial row plus its ledger
 * entry. Idempotent: the app's verify call and the webhook both land here.
 */
async function activateTrial(
  uid: string,
  sub: razorpay.RzpSubscription,
  paymentId: string | null,
): Promise<{ status: string; validUntil: string; provider: string }> {
  return transaction(async (q) => {
    // Serialises the verify call and the webhook for the same user.
    const [user] = await q('SELECT id FROM users WHERE id = $1 FOR UPDATE;', [uid]);
    if (!user) throw new Error(`Unknown user ${uid}`);

    const [existing] = await q<{ status: string; valid_until: string }>(
      `SELECT status, valid_until FROM subscriptions
       WHERE provider = 'razorpay' AND mandate_id = $1;`,
      [sub.id],
    );
    if (existing) {
      return { status: existing.status, validUntil: existing.valid_until, provider: 'razorpay' };
    }

    // Only a cancelled-but-unexpired one can be live here; startSubscription
    // refuses while a trial or active one exists.
    await q(
      `UPDATE subscriptions SET status = 'expired'
       WHERE user_id = $1 AND status IN ('trial','active','cancelled');`,
      [uid],
    );
    const now = iso();
    const validUntil = sub.start_at
      ? iso(sub.start_at * 1000)
      : iso(Date.now() + PRICING.trialDays * 86_400_000);
    const subscriptionId = newId('sub');
    await q(
      `INSERT INTO subscriptions
         (id, user_id, plan, status, trial_price, price, currency,
          provider, mandate_id, started_at, valid_until, cancelled_at)
       VALUES ($1, $2, 'monthly_premium', 'trial', $3, $4, 'INR',
               'razorpay', $5, $6, $7, NULL);`,
      [subscriptionId, uid, PRICING.trialPaise, PRICING.renewalPaise, sub.id, now, validUntil],
    );
    await recordPayment(q, {
      uid,
      subscriptionId,
      amount: PRICING.trialPaise,
      type: 'trial',
      providerTxnId: paymentId,
    });
    return { status: 'trial', validUntil, provider: 'razorpay' };
  });
}

/** Ledger insert that a retried webhook cannot duplicate. */
async function recordPayment(
  q: typeof query,
  p: { uid: string; subscriptionId: string; amount: number; type: string; providerTxnId: string | null },
): Promise<void> {
  await q(
    `INSERT INTO payments
       (id, user_id, subscription_id, amount, currency, type, status,
        provider, provider_txn_id, created_at)
     VALUES ($1, $2, $3, $4, 'INR', $5, 'success', 'razorpay', $6, $7)
     ON CONFLICT (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL DO NOTHING;`,
    [newId('pay'), p.uid, p.subscriptionId, p.amount, p.type, p.providerTxnId, iso()],
  );
}

interface RazorpayEvent {
  event: string;
  payload: {
    subscription?: { entity: razorpay.RzpSubscription };
    payment?: { entity: razorpay.RzpPayment };
  };
}

async function handleRazorpayEvent(event: RazorpayEvent): Promise<void> {
  const sub = event.payload.subscription?.entity;
  if (!sub) return; // not a subscription event
  const payment = event.payload.payment?.entity ?? null;

  if (event.event === 'subscription.authenticated') {
    const uid = razorpay.ownerOf(sub);
    if (uid) await activateTrial(uid, sub, payment?.id ?? null);
    return;
  }

  const [row] = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM subscriptions WHERE provider = 'razorpay' AND mandate_id = $1;`,
    [sub.id],
  );
  if (!row) return; // never authorised on our side; nothing to update

  switch (event.event) {
    case 'subscription.charged':
      await transaction(async (q) => {
        // A renewal extends access to the end of the cycle it paid for. A
        // cancelled row stays cancelled; the charge still buys its period.
        if (sub.current_end) {
          await q(
            `UPDATE subscriptions
             SET status = CASE WHEN status = 'trial' THEN 'active' ELSE status END,
                 valid_until = GREATEST(valid_until, $2)
             WHERE id = $1 AND status IN ('trial','active','cancelled');`,
            [row.id, iso(sub.current_end * 1000)],
          );
        }
        if (payment) {
          await recordPayment(q, {
            uid: row.user_id,
            subscriptionId: row.id,
            amount: payment.amount,
            type: 'renewal',
            providerTxnId: payment.id,
          });
        }
      });
      return;
    case 'subscription.halted':
      // Razorpay has given up retrying the debit; access ends now.
      await query(
        `UPDATE subscriptions SET status = 'failed', valid_until = $2
         WHERE id = $1 AND status IN ('trial','active');`,
        [row.id, iso()],
      );
      return;
    case 'subscription.cancelled':
      // Usually already done by /cancelSubscription; this catches dashboard
      // cancels and mandates the user revoked from their UPI app.
      await query(
        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2
         WHERE id = $1 AND status IN ('trial','active');`,
        [row.id, iso()],
      );
      return;
    case 'subscription.completed':
      await query(
        `UPDATE subscriptions SET status = 'expired'
         WHERE id = $1 AND status IN ('trial','active','cancelled') AND valid_until <= $2;`,
        [row.id, iso()],
      );
      return;
    default:
      // pending (retrying), updated, paused, resumed: no change to access.
      return;
  }
}

app.post('/cancelSubscription', async (req, res) => {
  const uid = res.locals.uid as string;
  const [live] = await query<{ id: string; provider: string | null; mandate_id: string | null }>(
    `SELECT id, provider, mandate_id FROM subscriptions
     WHERE user_id = $1 AND status IN ('trial','active');`,
    [uid],
  );
  if (!live) {
    res.json({ cancelled: false });
    return;
  }

  // Stop the debits before telling the user they are stopped.
  if (live.provider === 'razorpay' && live.mandate_id) {
    try {
      await razorpay.cancelSubscription(live.mandate_id);
    } catch (error) {
      const current = await razorpay.fetchSubscription(live.mandate_id).catch(() => null);
      if (!current || !['cancelled', 'completed', 'expired', 'halted'].includes(current.status)) {
        console.error('[razorpay cancel]', error);
        res.status(502).send('Could not cancel right now. Try again.');
        return;
      }
    }
  }

  // Access continues until valid_until, which is what the paywall promises.
  await query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2
     WHERE id = $1 AND status IN ('trial','active');`,
    [live.id, iso()],
  );
  res.json({ cancelled: true });
});

app.post('/getEntitlement', async (req, res) => {
  const uid = res.locals.uid as string;
  const [sub] = await query<{ status: string; valid_until: string }>(
    `SELECT status, valid_until FROM subscriptions
     WHERE user_id = $1 AND status IN ('trial','active','cancelled')
     ORDER BY started_at DESC LIMIT 1;`,
    [uid],
  );
  const premium = Boolean(sub) && Date.parse(sub.valid_until) > Date.now();
  res.json({ premium, validUntil: sub?.valid_until ?? null, status: sub?.status ?? 'none' });
});

app.post('/listPayments', async (req, res) => {
  const uid = res.locals.uid as string;
  res.json(
    await query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20;',
      [uid],
    ),
  );
});

app.listen(PORT, () => console.log(`vocalock api on :${PORT}`));
