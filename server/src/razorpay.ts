import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Razorpay Subscriptions, over its REST API directly. The surface used is four
 * calls and two signatures, which does not justify the SDK as a dependency.
 *
 * Docs: https://razorpay.com/docs/api/payments/subscriptions/
 */
const KEY_ID = process.env.RAZORPAY_KEY_ID ?? '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
const PLAN_ID = process.env.RAZORPAY_PLAN_ID ?? '';

const API = 'https://api.razorpay.com/v1';

export const razorpayKeyId = KEY_ID;
export const razorpayConfigured = Boolean(KEY_ID && KEY_SECRET && PLAN_ID);

/** Subscription entity, trimmed to the fields this server reads. Times are unix seconds. */
export interface RzpSubscription {
  id: string;
  status: string;
  plan_id: string;
  start_at: number | null;
  current_start: number | null;
  current_end: number | null;
  charge_at: number | null;
  ended_at: number | null;
  notes: Record<string, string> | [];
}

export interface RzpPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as {
    error?: { description?: string };
  };
  if (!response.ok) {
    throw new Error(`Razorpay ${method} ${path}: ${json.error?.description ?? response.status}`);
  }
  return json as T;
}

export function createSubscription(opts: {
  uid: string;
  /** Null when the person has had their trial: the plan price is charged now. */
  trial: { days: number; paise: number } | null;
  totalCount: number;
}): Promise<RzpSubscription> {
  const now = Math.floor(Date.now() / 1000);
  return call('POST', '/subscriptions', {
    plan_id: PLAN_ID,
    total_count: opts.totalCount,
    // Unpaid checkouts are abandoned rather than left payable for 30 years.
    expire_by: now + 86_400,
    // With a trial, the first plan-price debit waits until start_at and the
    // authorisation charges only the addon. Without one, start_at is left out
    // and the authorisation charges the first 30 days.
    ...(opts.trial
      ? {
          start_at: now + opts.trial.days * 86_400,
          addons: [
            { item: { name: `${opts.trial.days}-day trial`, amount: opts.trial.paise, currency: 'INR' } },
          ],
        }
      : {}),
    // `app` tells this account's other apps' webhooks the event is not theirs;
    // `trial` tells activation which kind of subscription it is looking at.
    notes: { uid: opts.uid, app: 'vocalock', trial: opts.trial ? '1' : '0' },
  });
}

/** Whether this subscription was created with the ₹1 trial. */
export function hasTrial(sub: RzpSubscription): boolean {
  return Array.isArray(sub.notes) ? true : sub.notes.trial !== '0';
}

export function fetchSubscription(id: string): Promise<RzpSubscription> {
  return call('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

export interface PaidInvoice {
  payment_id: string;
  /** Paise. */
  amount: number;
  date?: number;
}

/** The subscription's paid invoices, oldest first: the trial charge, then each renewal. */
export async function paidInvoices(subscriptionId: string): Promise<PaidInvoice[]> {
  const invoices = await call<{
    items: { status: string; payment_id: string | null; amount: number; date?: number }[];
  }>('GET', `/invoices?subscription_id=${encodeURIComponent(subscriptionId)}`);
  return invoices.items
    .filter((i): i is PaidInvoice & { status: string } => i.status === 'paid' && Boolean(i.payment_id))
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
}

/**
 * Stops all future debits now. Access is governed by our own valid_until, so
 * there is no reason to leave the mandate live until the cycle ends.
 */
export function cancelSubscription(id: string): Promise<RzpSubscription> {
  return call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
    cancel_at_cycle_end: false,
  });
}

/**
 * Whether a subscription is VocaLock's. The Razorpay account is shared with
 * other Indidino apps and every webhook receives every app's events, so the
 * handler must ignore the rest — failing on them would make Razorpay retry and
 * eventually disable the webhook. The plan is the reliable mark: only VocaLock
 * subscribes people to it.
 */
export function isOurs(sub: RzpSubscription): boolean {
  return Boolean(PLAN_ID) && sub.plan_id === PLAN_ID;
}

/** The uid we stamped on the subscription at creation, if any. */
export function ownerOf(sub: RzpSubscription): string | null {
  return Array.isArray(sub.notes) ? null : (sub.notes.uid ?? null);
}

function hmacMatches(secret: string, message: string | Buffer, signature: string): boolean {
  if (!secret) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(message).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Checkout's handler signature. `subscriptionId` must be the one this server
 * created, never the value echoed back by the client.
 */
export function checkoutSignatureValid(
  paymentId: string,
  subscriptionId: string,
  signature: string,
): boolean {
  return hmacMatches(KEY_SECRET, `${paymentId}|${subscriptionId}`, signature);
}

/** Webhook signature over the raw, unparsed request body. */
export function webhookSignatureValid(rawBody: Buffer, signature: string): boolean {
  return hmacMatches(WEBHOOK_SECRET, rawBody, signature);
}
