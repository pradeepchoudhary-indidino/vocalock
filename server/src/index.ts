import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { bearerToken, createSession, deleteSession, requireSession, verifyGoogleIdToken } from './auth';
import { query, transaction } from './db';
import * as razorpay from './razorpay';
import {
  PRICING,
  SUBSCRIPTION_CYCLES,
  activateSubscription,
  handleRazorpayEvent,
  liveSubscription,
  reconcile,
  stopMandate,
  trialEligible,
} from './subscriptions';
import { iso, newId } from './util';

const app = express();

const PORT = Number(process.env.PORT ?? 8080);

/**
 * Origins allowed to call the API from a browser context. The Android app's
 * WebView is the origin https://localhost, so every call it makes is
 * cross-origin; without these headers the WebView blocks them all.
 */
const CORS_ORIGINS = new Set(
  (process.env.CORS_ORIGINS ?? 'https://localhost,http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

// Behind a load balancer the client IP is in X-Forwarded-For; the rate limits
// below key on it, so tell Express how many proxies to trust.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 0));
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && CORS_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  // Preflights carry no token, so they must be answered before requireSession.
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Razorpay calls this, not the app, so it authenticates by signature rather
// than the bearer token. It needs the raw body for that, so it is registered
// before the JSON parser.
// Both spellings: the dashboard registration uses /webhook/, the docs /webhooks/.
app.post(['/webhooks/razorpay', '/webhook/razorpay'], express.raw({ type: '*/*' }), async (req, res) => {
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

// Per IP. Generous for a person, tight for a script.
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
// Per user. Each call creates a real Razorpay subscription, so a loop here
// would litter the dashboard with abandoned ones.
const purchaseLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (_req, res) => res.locals.uid as string,
});

app.post('/auth/google', authLimit, async (req, res) => {
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

app.post('/startSubscription', purchaseLimit, async (req, res) => {
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
    // Decided here, never by the app: one ₹1 trial per person.
    const trial = await trialEligible(uid);
    const sub = await razorpay.createSubscription({
      uid,
      trial: trial ? { days: PRICING.trialDays, paise: PRICING.trialPaise } : null,
      totalCount: SUBSCRIPTION_CYCLES,
    });
    res.json({
      checkout: { keyId: razorpay.razorpayKeyId, subscriptionId: sub.id, email: user.email },
      trial,
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
  if (!razorpay.isOurs(sub) || razorpay.ownerOf(sub) !== uid) {
    res.status(403).send('That subscription belongs to someone else.');
    return;
  }
  if (!razorpay.checkoutSignatureValid(paymentId, sub.id, signature)) {
    res.status(400).send('Payment could not be verified.');
    return;
  }
  res.json(await activateSubscription(uid, sub, paymentId));
});

/**
 * Asks Razorpay whether a checkout the app started was paid, for when the app
 * never got Checkout's answer: Android can discard the app while the user is
 * in the browser and the UPI app, and the redirect back then lands nowhere.
 * Razorpay is asked directly with the secret key, so this needs no signature
 * from the client and cannot be faked by it.
 */
app.post('/syncSubscription', async (req, res) => {
  const uid = res.locals.uid as string;
  let sub: razorpay.RzpSubscription;
  try {
    sub = await razorpay.fetchSubscription(String(req.body?.subscriptionId ?? ''));
  } catch {
    res.status(400).send('Unknown subscription.');
    return;
  }
  if (!razorpay.isOurs(sub) || razorpay.ownerOf(sub) !== uid) {
    res.status(403).send('That subscription belongs to someone else.');
    return;
  }
  // 'created' means checkout was opened but never paid.
  if (!['authenticated', 'active'].includes(sub.status)) {
    res.json({ status: 'pending' });
    return;
  }
  const [trial] = await razorpay.paidInvoices(sub.id).catch(() => []);
  res.json(await activateSubscription(uid, sub, trial?.payment_id ?? null));
});

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
  if (live.provider === 'razorpay' && live.mandate_id && !(await stopMandate(live.mandate_id))) {
    res.status(502).send('Could not cancel right now. Try again.');
    return;
  }

  // Cancelling ends Premium immediately; the app returns to the paywall.
  await query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2, valid_until = $2
     WHERE id = $1 AND status IN ('trial','active');`,
    [live.id, iso()],
  );
  res.json({ cancelled: true });
});

/**
 * Play's account-deletion requirement. Personal data goes: name, email, the
 * Google id, every session. The subscription and payment rows stay, attached to
 * an id that no longer leads to a person, because payment records must be kept
 * for tax purposes. The mandate is stopped first so nothing is charged after.
 */
app.post('/deleteAccount', async (req, res) => {
  const uid = res.locals.uid as string;
  const [live] = await query<{ provider: string | null; mandate_id: string | null }>(
    `SELECT provider, mandate_id FROM subscriptions
     WHERE user_id = $1 AND status IN ('trial','active');`,
    [uid],
  );
  if (live?.provider === 'razorpay' && live.mandate_id && !(await stopMandate(live.mandate_id))) {
    res.status(502).send('Could not stop your subscription, so the account was not deleted. Try again.');
    return;
  }

  const now = iso();
  await transaction(async (q) => {
    await q(
      `UPDATE subscriptions SET status = 'expired', valid_until = $2,
         cancelled_at = COALESCE(cancelled_at, $2)
       WHERE user_id = $1 AND status IN ('trial','active','cancelled');`,
      [uid, now],
    );
    await q(
      `UPDATE users SET google_sub = NULL, email = NULL, name = NULL, phone = NULL,
         app_version = NULL, device_model = NULL, last_seen_at = $2
       WHERE id = $1;`,
      [uid, now],
    );
    await q('DELETE FROM sessions WHERE user_id = $1;', [uid]);
  });
  res.json({ deleted: true });
});

app.post('/getEntitlement', async (req, res) => {
  const uid = res.locals.uid as string;
  let sub = await liveSubscription(uid);
  const mandateId = sub?.provider === 'razorpay' ? sub.mandate_id : null;
  if (sub && mandateId && sub.status !== 'cancelled' && Date.parse(sub.valid_until) <= Date.now()) {
    try {
      await reconcile({ id: sub.id, user_id: sub.user_id, mandate_id: mandateId });
      sub = await liveSubscription(uid);
    } catch (error) {
      // Razorpay unreachable: answer from what we have rather than fail.
      console.error('[reconcile]', mandateId, error);
    }
  }
  const premium = sub !== undefined && Date.parse(sub.valid_until) > Date.now();
  res.json({
    premium,
    validUntil: sub?.valid_until ?? null,
    status: sub?.status ?? 'none',
    // Which price the paywall shows: ₹1 trial, or ₹199 now for a returning user.
    trialEligible: premium ? false : await trialEligible(uid),
  });
});

// Express 5 routes a rejected async handler here instead of crashing the
// process. The detail goes to the log, never to the client.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', error);
  if (!res.headersSent) res.status(500).send('Something went wrong. Try again.');
});

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

// 127.0.0.1 behind a reverse proxy on the same machine; 0.0.0.0 in a container.
const HOST = process.env.HOST ?? '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`vocalock api on ${HOST}:${PORT}`));
