import { query, transaction } from './db';
import * as razorpay from './razorpay';
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

/**
 * Turns an authorised Razorpay subscription into a trial row plus its ledger
 * entry. Idempotent: the app's verify call and the webhook both land here.
 */
export async function activateTrial(
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
      await recordPayment(q, {
        uid: row.user_id,
        subscriptionId: row.id,
        amount: p.amount,
        type: 'renewal',
        providerTxnId: p.payment_id,
      });
    }
  });
}

/**
 * Razorpay has ended the subscription.
 * - halted: every retry of a renewal failed; access ends now.
 * - cancelled: usually already done by /cancelSubscription; this catches
 *   dashboard cancels and mandates revoked from the user's UPI app.
 * - completed: every billing cycle has run.
 */
async function applyLapse(rowId: string, razorpayStatus: string): Promise<void> {
  if (razorpayStatus === 'halted') {
    await query(
      `UPDATE subscriptions SET status = 'failed', valid_until = $2
       WHERE id = $1 AND status IN ('trial','active');`,
      [rowId, iso()],
    );
  } else if (razorpayStatus === 'cancelled') {
    await query(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = $2
       WHERE id = $1 AND status IN ('trial','active');`,
      [rowId, iso()],
    );
  } else if (razorpayStatus === 'completed' || razorpayStatus === 'expired') {
    await query(
      `UPDATE subscriptions SET status = 'expired'
       WHERE id = $1 AND status IN ('trial','active','cancelled') AND valid_until <= $2;`,
      [rowId, iso()],
    );
  }
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
    await applyLapse(row.id, sub.status);
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
      await applyRenewal(row, sub.current_end, payment ? [{ payment_id: payment.id, amount: payment.amount }] : []);
      return;
    case 'subscription.halted':
    case 'subscription.cancelled':
    case 'subscription.completed':
      await applyLapse(row.id, sub.status);
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
