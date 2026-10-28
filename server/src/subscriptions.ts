import { query, transaction } from './db';
import * as razorpay from './razorpay';
import { logEvent } from './events';
import { reportRenewal, reportTrial } from './meta';
import { iso, newId } from './util';

/**
 * Subscription state: what the routes, the Razorpay webhook and the
 * entitlement check all change. Every function here is idempotent, because the
 * same payment can arrive through verify, sync, the webhook and a reconcile.
 */

const RUPEE = 100;
/** ₹1 for a 1-day trial, then ₹199 every 30 days (the Razorpay plan's period). */
export const PRICING = { trialPaise: 1 * RUPEE, renewalPaise: 199 * RUPEE, trialDays: 1 };
/** 30-day debits the mandate covers: about five years, then the user re-subscribes. */
export const SUBSCRIPTION_CYCLES = 60;

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 30;

/**
 * Whether this user may still have the ₹1 trial: one per Google account, ever.
 * Claims are keyed by a hash of the Google id, so they outlive Delete account.
 */
export async function trialEligible(uid: string): Promise<boolean> {
  const [row] = await query<{ claimed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM trial_claims c JOIN users u ON u.google_sub IS NOT NULL
         AND c.google_sub_hash = encode(sha256(u.google_sub::bytea), 'hex')
       WHERE u.id = $1
     ) OR EXISTS (
       SELECT 1 FROM subscriptions WHERE user_id = $1 AND provider = 'razorpay'
     ) AS claimed;`,
    [uid],
  );
  return !row?.claimed;
}

/**
 * Turns an authorised Razorpay subscription into a subscription row plus its
 * ledger entry: a trial (₹1 now, plan price from start_at) or, for someone who
 * has had their trial, a paid first period. Idempotent: the app's verify call,
 * the sync and the webhook can all land here.
 */
export async function activateSubscription(
  uid: string,
  sub: razorpay.RzpSubscription,
  paymentId: string | null,
): Promise<{ status: string; validUntil: string; provider: string }> {
  let started = null as { status: string; amount: number } | null;
  const result = await transaction(async (q) => {
    // Serialises the verify call and the webhook for the same user.
    const [user] = await q('SELECT id FROM users WHERE id = $1 FOR UPDATE;', [uid]);
    if (!user) throw new Error(`Unknown user ${uid}`);

    const [existing] = await q<{ id: string; status: string; valid_until: string }>(
      `SELECT id, status, valid_until FROM subscriptions
       WHERE provider = 'razorpay' AND mandate_id = $1;`,
      [sub.id],
    );
    if (existing) {
      // The webhook usually lands first and carries no payment; the app's
      // verify, a moment later, does. Fill the id in so every payment can be
      // traced to Razorpay (refunds, disputes).
      if (paymentId) {
        await q(
          `UPDATE payments SET provider_txn_id = $1, provider = 'razorpay'
           WHERE subscription_id = $2 AND provider_txn_id IS NULL AND status = 'success'
             AND NOT EXISTS (SELECT 1 FROM payments WHERE provider = 'razorpay' AND provider_txn_id = $1);`,
          [paymentId, existing.id],
        );
      }
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
    const trial = razorpay.hasTrial(sub);
    const status = trial ? 'trial' : 'active';
    const validUntil = trial
      ? iso((sub.start_at ?? Date.now() / 1000 + PRICING.trialDays * 86_400) * 1000)
      : iso(sub.current_end ? sub.current_end * 1000 : Date.now() + PERIOD_DAYS * DAY_MS);
    const subscriptionId = newId('sub');
    await q(
      `INSERT INTO subscriptions
         (id, user_id, plan, status, trial_price, price, currency,
          provider, mandate_id, started_at, valid_until, cancelled_at)
       VALUES ($1, $2, 'monthly_premium', $3, $4, $5, 'INR',
               'razorpay', $6, $7, $8, NULL);`,
      [subscriptionId, uid, status, trial ? PRICING.trialPaise : 0, PRICING.renewalPaise, sub.id, now, validUntil],
    );
    await recordPayment(q, {
      uid,
      subscriptionId,
      amount: trial ? PRICING.trialPaise : PRICING.renewalPaise,
      // A paid first period is recorded as a renewal: a full-price period charge.
      type: trial ? 'trial' : 'renewal',
      providerTxnId: paymentId,
    });
    started = { status, amount: trial ? PRICING.trialPaise : PRICING.renewalPaise };
    if (trial) {
      await q(
        `INSERT INTO trial_claims (google_sub_hash, claimed_at)
         SELECT encode(sha256(google_sub::bytea), 'hex'), $2 FROM users
         WHERE id = $1 AND google_sub IS NOT NULL
         ON CONFLICT DO NOTHING;`,
        [uid, now],
      );
    }
    return { status, validUntil, provider: 'razorpay' };
  });
  // After the commit, and only for the call that created the row.
  if (started) {
    logEvent(uid, started.status === 'trial' ? 'trial_started' : 'subscription_started', { rupees: started.amount / RUPEE });
    if (started.status === 'trial') void reportTrial(uid, sub.id, started.amount);
  }
  return result;
}


/**
 * Ledger insert that a retried webhook cannot duplicate. True if this call
 * recorded the payment, false if it was already there.
 */
async function recordPayment(
  q: typeof query,
  p: { uid: string; subscriptionId: string; amount: number; type: string; providerTxnId: string | null },
): Promise<boolean> {
  const inserted = await q(
    `INSERT INTO payments
       (id, user_id, subscription_id, amount, currency, type, status,
        provider, provider_txn_id, created_at)
     VALUES ($1, $2, $3, $4, 'INR', $5, 'success', 'razorpay', $6, $7)
     ON CONFLICT (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL DO NOTHING
     RETURNING id;`,
    [newId('pay'), p.uid, p.subscriptionId, p.amount, p.type, p.providerTxnId, iso()],
  );
  return inserted.length > 0;
}

interface SubscriptionRef {
  id: string;
  user_id: string;
}

/**
 * A paid renewal extends access to the end of the cycle it paid for. A
 * cancelled row stays cancelled; the charge still buys its period. Payments are
 * recorded idempotently, so a webhook and a reconcile can both pass them in.
 */
async function applyRenewal(
  row: SubscriptionRef,
  currentEnd: number | null,
  payments: { payment_id: string; amount: number }[],
): Promise<void> {
  const recorded: { payment_id: string; amount: number }[] = [];
  await transaction(async (q) => {
    if (currentEnd) {
      await q(
        `UPDATE subscriptions
         SET status = CASE WHEN status = 'trial' THEN 'active' ELSE status END,
             valid_until = GREATEST(valid_until, $2)
         WHERE id = $1 AND status IN ('trial','active','cancelled');`,
        [row.id, iso(currentEnd * 1000)],
      );
    }
    for (const p of payments) {
      const isNew = await recordPayment(q, {
        uid: row.user_id,
        subscriptionId: row.id,
        amount: p.amount,
        type: 'renewal',
        providerTxnId: p.payment_id,
      });
      if (isNew) recorded.push(p);
    }
  });
  // After the commit, and only for payments this call recorded: a payment the
  // app already reported (a paid first period) or a retried webhook is skipped.
  for (const p of recorded) {
    void reportRenewal(row.user_id, p.payment_id, p.amount);
    logEvent(row.user_id, 'renewal_charged', { rupees: p.amount / RUPEE });
  }
}

/**
 * Razorpay has ended the subscription.
 * - halted: every retry of a renewal failed; access ends now.
 * - cancelled: usually already done by /cancelSubscription; this catches
 *   dashboard cancels and mandates revoked from the user's UPI app. Access
 *   ends immediately, as it does for an in-app cancel.
 * - completed: every billing cycle has run.
 */
async function applyLapse(row: SubscriptionRef, razorpayStatus: string): Promise<void> {
  let changed: unknown[] = [];
  if (razorpayStatus === 'halted') {
    changed = await query(
      `UPDATE subscriptions SET status = 'failed', valid_until = $2
       WHERE id = $1 AND status IN ('trial','active') RETURNING id;`,
      [row.id, iso()],
    );
  } else if (razorpayStatus === 'cancelled') {
    // Cancelling ends Premium immediately, wherever it was done.
    changed = await query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2, valid_until = $2
       WHERE id = $1 AND status IN ('trial','active') RETURNING id;`,
      [row.id, iso()],
    );
  } else if (razorpayStatus === 'completed' || razorpayStatus === 'expired') {
    changed = await query(
      `UPDATE subscriptions SET status = 'expired'
       WHERE id = $1 AND status IN ('trial','active','cancelled') AND valid_until <= $2 RETURNING id;`,
      [row.id, iso()],
    );
  }
  // An in-app cancel already logged itself and left nothing for this to change.
  if (changed.length) logEvent(row.user_id, `subscription_${razorpayStatus}`, { by: 'razorpay' });
}

/**
 * The webhook is the normal path for renewals, but a missed or delayed one must
 * not lock out someone who paid. When a live subscription's paid period has
 * run out, Razorpay is asked directly before the app is told it expired.
 */
export async function reconcile(row: SubscriptionRef & { mandate_id: string }): Promise<void> {
  const sub = await razorpay.fetchSubscription(row.mandate_id);
  if (sub.status === 'active' && sub.current_end && sub.current_end * 1000 > Date.now()) {
    // Every paid invoice after the first (the trial) is a renewal.
    const renewals = (await razorpay.paidInvoices(sub.id).catch(() => [])).slice(1);
    await applyRenewal(row, sub.current_end, renewals);
  } else {
    await applyLapse(row, sub.status);
  }
}

interface RazorpayEvent {
  event: string;
  payload: {
    subscription?: { entity: razorpay.RzpSubscription };
    payment?: { entity: razorpay.RzpPayment };
  };
}

export async function handleRazorpayEvent(event: RazorpayEvent): Promise<void> {
  const sub = event.payload.subscription?.entity;
  if (!sub) return; // not a subscription event
  if (!razorpay.isOurs(sub)) return; // another app on the shared account
  const payment = event.payload.payment?.entity ?? null;

  if (event.event === 'subscription.authenticated') {
    const uid = razorpay.ownerOf(sub);
    if (!uid) return;
    // This event has no payment entity: look the authorisation payment up, as
    // the app's sync does, so the row is not saved without its Razorpay id.
    const paymentId = payment?.id ?? (await razorpay.paidInvoices(sub.id).catch(() => []))[0]?.payment_id ?? null;
    await activateSubscription(uid, sub, paymentId);
    return;
  }

  const [row] = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM subscriptions WHERE provider = 'razorpay' AND mandate_id = $1;`,
    [sub.id],
  );
  if (!row) return; // never authorised on our side; nothing to update

  switch (event.event) {
    case 'subscription.charged':
      await applyRenewal(row, sub.current_end, payment ? [{ payment_id: payment.id, amount: payment.amount }] : []);
      return;
    case 'subscription.halted':
    case 'subscription.cancelled':
    case 'subscription.completed':
      await applyLapse(row, sub.status);
      return;
    default:
      // pending (retrying), updated, paused, resumed: no change to access.
      return;
  }
}

/**
 * Stops future debits at Razorpay for the user's live subscription, if it has
 * one. Returns false only when Razorpay could not be reached and the mandate
 * may still be live — the caller must then not claim it is stopped.
 */
export async function stopMandate(mandateId: string): Promise<boolean> {
  try {
    await razorpay.cancelSubscription(mandateId);
    return true;
  } catch (error) {
    const current = await razorpay.fetchSubscription(mandateId).catch(() => null);
    if (current && ['cancelled', 'completed', 'expired', 'halted'].includes(current.status)) {
      return true; // already stopped
    }
    console.error('[razorpay cancel]', error);
    return false;
  }
}

interface LiveSubscription {
  id: string;
  user_id: string;
  status: string;
  valid_until: string;
  provider: string | null;
  mandate_id: string | null;
}

export async function liveSubscription(uid: string): Promise<LiveSubscription | undefined> {
  const [sub] = await query<LiveSubscription>(
    `SELECT id, user_id, status, valid_until, provider, mandate_id FROM subscriptions
     WHERE user_id = $1 AND status IN ('trial','active','cancelled')
     ORDER BY started_at DESC LIMIT 1;`,
    [uid],
  );
  return sub;
}
