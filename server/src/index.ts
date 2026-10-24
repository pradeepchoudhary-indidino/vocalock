import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { bearerToken, createSession, deleteSession, requireSession, sessionUser, verifyGoogleIdToken } from './auth';
import { query, transaction } from './db';
import { readAppConfig } from './config';
import { insertAppEvents, logEvent, parseAppEvents } from './events';
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
    logEvent(null, 'sign_in_failed', {}, req.body?.appVersion);
    res.status(401).send('Google sign-in could not be verified.');
    return;
  }

  // Registration is implicit: a verified Google account is a user.
  const now = iso();
  const [user] = await query<{ id: string; email: string | null; name: string | null; created: boolean }>(
    `INSERT INTO users (id, google_sub, email, name, created_at, last_seen_at, app_version, device_model)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
     ON CONFLICT (google_sub) WHERE google_sub IS NOT NULL DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           last_seen_at = EXCLUDED.last_seen_at,
           app_version = EXCLUDED.app_version,
           device_model = EXCLUDED.device_model,
           deleted_at = NULL
     RETURNING id, email, name, (xmax = 0) AS created;`,
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
  logEvent(user.id, user.created ? 'signup' : 'sign_in', { device_model: req.body?.deviceModel ?? null }, req.body?.appVersion);
  // `created` lets the app report a sign-up to Meta once, not on every sign-in.
  // 1.0-1.3 crash when told to report a sign-up to Meta: their Meta SDK never
  // initialises. Only 1.4+ is told it was a new account.
  const created = user.created && versionAtLeast(req.body?.appVersion, '1.4.0');
  res.json({ uid: user.id, email: user.email, name: user.name, token, created });
});

// Everything below acts on the signed-in user, and only that user.
// ---------------------------------------------------------------- app config

// Public and before requireSession: the paywall reads it before anyone signs in.
app.get('/config', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await readAppConfig());
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- app events

// Per IP, and generous: Indian mobile carriers put many phones behind one IP.
const eventsLimit = rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false });

// Before requireSession: the app reports events from before sign-in too, tied
// together by the install's anon_id in props. With a valid session the events
// are attributed to that user.
app.post('/events', eventsLimit, async (req, res, next) => {
  try {
    const events = parseAppEvents(req.body);
    const uid = await sessionUser(req).catch(() => null);
    await insertAppEvents(uid, req.body?.appVersion, events);
    res.json({ stored: events.length });
  } catch (error) {
    next(error);
  }
});

app.use(requireSession);

/** The Meta SDK's ids for this install; see meta.ts for what they are for. */
app.post('/me/attribution', async (req, res) => {
  const uid = res.locals.uid as string;
  const anonId = String(req.body?.anonId ?? '').slice(0, 128);
  const advertiserId = req.body?.advertiserId ? String(req.body.advertiserId).slice(0, 64) : null;
  if (!anonId) {
    res.status(400).send('anonId required');
    return;
  }
  const text = (v: unknown) => (v ? String(v).slice(0, 64) : null);
  await query(
    `UPDATE users SET meta_anon_id = $2, meta_advertiser_id = $3, meta_tracking_limited = $4,
       meta_os_version = $5, meta_device_model = $6, meta_app_version = $7 WHERE id = $1;`,
    [uid, anonId, advertiserId, req.body?.trackingLimited !== false,
      text(req.body?.osVersion), text(req.body?.deviceModel), text(req.body?.appVersion)],
  );
  res.json({ ok: true });
});

app.post('/auth/signOut', async (req, res) => {
  await deleteSession(bearerToken(req));
  logEvent(res.locals.uid as string, 'sign_out');
  res.json({ ok: true });
});

// ------------------------------------------------------- subscriptions

app.post('/startSubscription', purchaseLimit, async (req, res) => {
  const uid = res.locals.uid as string;
  if (razorpay.razorpayConfigured) {
    await startRazorpaySubscription(uid, res, req.body?.prepare === true);
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
async function startRazorpaySubscription(
  uid: string,
  res: express.Response,
  /** Created as the paywall opens, ahead of any tap: logged as such, not as a checkout. */
  prepare = false,
): Promise<void> {
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
    logEvent(uid, 'checkout_blocked', { reason: 'already_premium' });
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
    logEvent(uid, prepare ? 'checkout_prepared' : 'checkout_started', { trial });
    res.json({
      checkout: { keyId: razorpay.razorpayKeyId, subscriptionId: sub.id, email: user.email },
      trial,
    });
  } catch (error) {
    console.error('[razorpay create]', error);
    logEvent(uid, 'checkout_error', { message: (error as Error).message?.slice(0, 200) });
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
    logEvent(uid, 'payment_verify_failed', { reason: 'bad_signature' });
    res.status(400).send('Payment could not be verified.');
    return;
  }
  res.json(await forAppVersion(uid, await activateSubscription(uid, sub, paymentId)));
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
  res.json(await forAppVersion(uid, await activateSubscription(uid, sub, trial?.payment_id ?? null)));
});

/**
 * A checkout attempt that did not go through, reported by the app (1.5+) with
 * the payment id Checkout gave it. Checked against Razorpay — the app's word is
 * not taken for any of it — then kept in payments, so every attempt a user made,
 * paid or failed, is on their record and not only in Razorpay's dashboard.
 */
app.post('/paymentAttempt', async (req, res) => {
  const uid = res.locals.uid as string;
  const paymentId = String(req.body?.paymentId ?? '');
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    res.status(400).send('paymentId required');
    return;
  }
  let payment: razorpay.RzpPaymentAttempt;
  try {
    payment = await razorpay.fetchPayment(paymentId);
  } catch {
    res.status(400).send('Unknown payment.');
    return;
  }
  const notes = Array.isArray(payment.notes) ? {} : payment.notes;
  const [user] = await query<{ email: string | null }>('SELECT email FROM users WHERE id = $1;', [uid]);
  // Ours (the tag Checkout stamps), and this user's: by uid on 1.5+, by email before.
  const mine =
    notes._source === 'vocalock' &&
    (notes.uid ? notes.uid === uid : Boolean(user?.email) && payment.email === user?.email);
  if (!mine) {
    res.status(403).send('That payment belongs to someone else.');
    return;
  }
  // A captured one is recorded by verify/sync, with its subscription; only the
  // ones that went nowhere are recorded here.
  if (payment.status === 'failed') {
    await query(
      `INSERT INTO payments
         (id, user_id, subscription_id, amount, currency, type, status, provider, provider_txn_id, created_at)
       VALUES ($1, $2, NULL, $3, $4, $5, 'failed', 'razorpay', $6, $7)
       ON CONFLICT (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL DO NOTHING;`,
      [
        newId('pay'),
        uid,
        payment.amount,
        payment.currency,
        payment.amount <= PRICING.trialPaise ? 'trial' : 'renewal',
        payment.id,
        iso(payment.created_at * 1000),
      ],
    );
    logEvent(uid, 'payment_failed', {
      payment_id: payment.id,
      method: payment.method,
      reason: payment.error_reason,
      code: payment.error_code,
      rupees: payment.amount / 100,
    });
  }
  res.json({ status: payment.status });
});

/**
 * 1.0-1.3 report a purchase to Meta whenever the result names a provider, and
 * that call crashes them (their Meta SDK never initialises). They use provider
 * for nothing else, so they are sent null. The version is the one the app last
 * reported: Meta attribution on each launch (1.4+), else the one at sign-in.
 */
type PurchaseResult = { status: string; validUntil: string; provider: string | null };
async function forAppVersion(uid: string, result: PurchaseResult): Promise<PurchaseResult> {
  const [user] = await query<{ version: string | null }>(
    'SELECT COALESCE(meta_app_version, app_version) AS version FROM users WHERE id = $1;',
    [uid],
  );
  return versionAtLeast(user?.version, '1.4.0') ? result : { ...result, provider: null };
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
  if (live.provider === 'razorpay' && live.mandate_id && !(await stopMandate(live.mandate_id))) {
    res.status(502).send('Could not cancel right now. Try again.');
    return;
  }

  // Cancelling ends Premium immediately; the app returns to the paywall.
  const changed = await query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2, valid_until = $2
     WHERE id = $1 AND status IN ('trial','active') RETURNING id;`,
    [live.id, iso()],
  );
  // Stopping the mandate makes Razorpay send its cancelled webhook, which can
  // land before this update and log the cancel itself. One cancel, one event.
  if (changed.length) logEvent(uid, 'subscription_cancelled', { by: 'app' });
  res.json({ cancelled: true });
});

/** Whether a dotted version is at least `min`; anything unparseable is not. */
function versionAtLeast(version: unknown, min: string): boolean {
  const a = String(version ?? '').split('.').map(Number);
  const b = min.split('.').map(Number);
  if (a.some(Number.isNaN) || a.length < 2) return false;
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

/**
 * Delete account. Every account keeps its data and is only marked deleted
 * (signing in again with the same Google account brings it back); erasure is
 * on request to support, as the privacy policy says. From 1.4 only a manual
 * cancel (/cancelSubscription) stops the mandate. Older apps promised
 * "cancelled straight away", so for them it still stops the mandate.
 */
app.post('/deleteAccount', async (req, res) => {
  const uid = res.locals.uid as string;
  const keepsSubscription = versionAtLeast(req.body?.appVersion, '1.4.0');

  if (!keepsSubscription) {
    const [live] = await query<{ provider: string | null; mandate_id: string | null }>(
      `SELECT provider, mandate_id FROM subscriptions
       WHERE user_id = $1 AND status IN ('trial','active');`,
      [uid],
    );
    if (live?.provider === 'razorpay' && live.mandate_id && !(await stopMandate(live.mandate_id))) {
      res.status(502).send('Could not stop your subscription, so the account was not deleted. Try again.');
      return;
    }
  }
  const now = iso();
  await transaction(async (q) => {
    if (!keepsSubscription) {
      await q(
        `UPDATE subscriptions SET status = 'expired', valid_until = $2,
           cancelled_at = COALESCE(cancelled_at, $2)
         WHERE user_id = $1 AND status IN ('trial','active','cancelled');`,
        [uid, now],
      );
    }
    await q('UPDATE users SET deleted_at = $2, last_seen_at = $2 WHERE id = $1;', [uid, now]);
    await q('DELETE FROM sessions WHERE user_id = $1;', [uid]);
  });
  logEvent(uid, 'account_deleted', {}, req.body?.appVersion);
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
  // The app asks on launch, on every return to the foreground and after
  // sign-in, so this doubles as an app-open event until the app sends its own.
  logEvent(uid, 'app_foreground', { premium, status: sub?.status ?? 'none' });
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
