import express from 'express';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { query, transaction } from './db';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 8080);
const API_TOKEN = process.env.API_TOKEN ?? '';
const STATIC_OTP = process.env.STATIC_OTP !== 'false';
const STATIC_OTP_CODE = process.env.STATIC_OTP_CODE ?? '1234';

const PHONE_PATTERN = /^\+91[6-9]\d{9}$/;
const RUPEE = 100;
const PRICING = { trialPaise: 1 * RUPEE, monthlyPaise: 499 * RUPEE, trialDays: 3 };

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;

/** Constant-time compare so a token cannot be guessed a byte at a time. */
function tokenMatches(given: string): boolean {
  if (!API_TOKEN) return true; // no token configured: open, for local dev only
  const a = Buffer.from(given);
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const header = req.header('authorization') ?? '';
  if (!tokenMatches(header.replace(/^Bearer /, ''))) {
    res.status(401).send('Unauthorised');
    return;
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- OTP

app.post('/requestOtp', async (req, res) => {
  const phone = String(req.body?.phone ?? '');
  if (!PHONE_PATTERN.test(phone)) {
    res.status(400).send('Enter a valid Indian mobile number.');
    return;
  }

  const [existing] = await query<{ last_sent_at: string }>(
    'SELECT last_sent_at FROM otp_codes WHERE phone = $1;',
    [phone],
  );
  if (existing && Date.now() - Date.parse(existing.last_sent_at) < OTP_RESEND_COOLDOWN_MS) {
    res.status(429).send('Please wait before asking for another code.');
    return;
  }

  const code = STATIC_OTP ? STATIC_OTP_CODE : String(randomInt(1000, 10000));
  await query(
    `INSERT INTO otp_codes (phone, code, expires_at, attempts, last_sent_at)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (phone) DO UPDATE
       SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at,
           attempts = 0, last_sent_at = EXCLUDED.last_sent_at;`,
    [phone, code, iso(Date.now() + OTP_TTL_MS), iso()],
  );

  if (!STATIC_OTP) await sendSms(phone, code);
  res.json({ sent: true, static: STATIC_OTP });
});

app.post('/verifyOtp', async (req, res) => {
  const phone = String(req.body?.phone ?? '');
  const code = String(req.body?.code ?? '');
  if (!PHONE_PATTERN.test(phone)) {
    res.status(400).send('Enter a valid Indian mobile number.');
    return;
  }

  const [record] = await query<{ code: string; expires_at: string; attempts: number }>(
    'SELECT code, expires_at, attempts FROM otp_codes WHERE phone = $1;',
    [phone],
  );
  const valid =
    record &&
    Date.parse(record.expires_at) > Date.now() &&
    record.attempts < OTP_MAX_ATTEMPTS &&
    record.code === code;

  if (!valid) {
    if (record) await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1;', [phone]);
    res.status(401).send('That code did not work.');
    return;
  }
  await query('DELETE FROM otp_codes WHERE phone = $1;', [phone]); // single use

  // Registration is implicit: a verified number is a user.
  const now = iso();
  const [user] = await query<{ id: string; phone: string }>(
    `INSERT INTO users (id, phone, created_at, last_seen_at, app_version, device_model)
     VALUES ($1, $2, $3, $3, $4, $5)
     ON CONFLICT (phone) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at,
           app_version = EXCLUDED.app_version,
           device_model = EXCLUDED.device_model
     RETURNING id, phone;`,
    [newId('usr'), phone, now, String(req.body?.appVersion ?? ''), String(req.body?.deviceModel ?? '')],
  );

  res.json({ uid: user.id, phone: user.phone });
});

// ------------------------------------------------------- subscriptions

app.post('/startSubscription', async (req, res) => {
  const uid = String(req.body?.uid ?? '');
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
        [newId('sub'), uid, PRICING.trialPaise, PRICING.monthlyPaise, now, validUntil],
      );
      // Ledger row even though nothing was charged, so the table shape is
      // already right when a gateway is added.
      await q(
        `INSERT INTO payments
           (id, user_id, subscription_id, amount, currency, type, status,
            provider, provider_txn_id, created_at)
         VALUES ($1, $2, $3, $4, 'INR', 'trial', 'simulated', NULL, NULL, $5);`,
        [newId('pay'), uid, sub.id, PRICING.trialPaise, now],
      );
      return sub;
    });
    res.json({ status: 'trial', validUntil: subscription.valid_until });
  } catch (error) {
    res.status(400).send((error as Error).message);
  }
});

app.post('/cancelSubscription', async (req, res) => {
  const uid = String(req.body?.uid ?? '');
  // Access continues until valid_until, which is what the paywall promises.
  const rows = await query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2
     WHERE user_id = $1 AND status IN ('trial','active')
     RETURNING id;`,
    [uid, iso()],
  );
  res.json({ cancelled: rows.length > 0 });
});

app.post('/getEntitlement', async (req, res) => {
  const uid = String(req.body?.uid ?? '');
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
  const uid = String(req.body?.uid ?? '');
  res.json(
    await query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20;',
      [uid],
    ),
  );
});

/** Not implemented. Wire MSG91/Twilio here and set STATIC_OTP=false. */
async function sendSms(phone: string, code: string): Promise<void> {
  throw new Error(`No SMS provider configured (wanted to send ${code} to ${phone})`);
}

app.listen(PORT, () => console.log(`vocalock api on :${PORT}`));
