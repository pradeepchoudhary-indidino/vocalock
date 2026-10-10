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

/**
 * The trial is the subscription's start date pushed out by `trialDays`, with the
 * trial price charged as an addon on the authorisation payment. The first
 * plan-price debit happens on `start_at`.
 */
export function createSubscription(opts: {
  uid: string;
  trialDays: number;
  trialPaise: number;
  totalCount: number;
}): Promise<RzpSubscription> {
  return call('POST', '/subscriptions', {
    plan_id: PLAN_ID,
    total_count: opts.totalCount,
    start_at: Math.floor(Date.now() / 1000) + opts.trialDays * 86_400,
    // Unpaid checkouts are abandoned rather than left payable for 30 years.
    expire_by: Math.floor(Date.now() / 1000) + 86_400,
    addons: [
      { item: { name: `${opts.trialDays}-day trial`, amount: opts.trialPaise, currency: 'INR' } },
    ],
    // `app` tells this account's other apps' webhooks the event is not theirs.
    notes: { uid: opts.uid, app: 'vocalock' },
  });
}

export function fetchSubscription(id: string): Promise<RzpSubscription> {
  return call('GET', `/subscriptions/${encodeURIComponent(id)}`);
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
