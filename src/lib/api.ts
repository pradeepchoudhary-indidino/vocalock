import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { SqliteRepository } from '../db/sqlite';
import type { Repository } from '../db/types';
import { APP_VERSION } from './analytics';
import { metaAttribution } from './meta';
import { CheckoutDismissed, openSubscriptionCheckout } from './razorpay';

/**
 * Backend client.
 *
 * Every call goes through here so there is exactly one place to swap the stub
 * for the Node API. When VITE_API_BASE is set the calls go over the
 * network; when it is not, they resolve locally so the app is still fully
 * usable — which is the state it ships in today.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
/** The "Web application" OAuth client. Android uses it too, as the token audience. */
const GOOGLE_WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ?? '';

export interface Session {
  uid: string;
  /** True on the sign-in that created the account. Not persisted. */
  created?: boolean;
  email: string | null;
  name: string | null;
  /** The server's session token. Absent in the local stub, which has no server. */
  token?: string;
}

/** The server no longer accepts this session; the user has to sign in again. */
export class SessionExpired extends Error {
  constructor() {
    super('Please sign in again.');
  }
}

const backendConfigured = API_BASE !== '';

/**
 * The on-device database. Used while there is no server; once VITE_API_BASE
 * points at the Node API on RDS the same calls go over HTTP instead, and this
 * stays only as the offline cache.
 */
const local: Repository = new SqliteRepository();
let ready: Promise<void> | null = null;

function db(): Promise<void> {
  ready ??= local.init();
  return ready;
}

/**
 * The server derives the user from `session.token`; nothing in the body says
 * who is calling.
 */
async function post<T>(path: string, session: Session | null, body: unknown = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401 && session) throw new SessionExpired();
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

let googleReady: Promise<void> | null = null;

/**
 * Loads Google's sign-in. On the web this injects Google's script, which must
 * be done ahead of the tap, so the Login screen calls it on mount.
 */
export function prepareGoogleSignIn(): Promise<void> {
  if (!GOOGLE_WEB_CLIENT_ID) return Promise.resolve();
  googleReady ??= SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } });
  return googleReady;
}

/** The user closed Google's account picker. Not an error worth showing. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
  }
}

export async function signInWithGoogle(): Promise<Session> {
  const meta = { appVersion: APP_VERSION, deviceModel: Capacitor.getPlatform() };

  if (!GOOGLE_WEB_CLIENT_ID) {
    // Not configured: only the local stub can do without Google, as a single
    // test account, so the UI stays usable in a plain `npm run dev`.
    if (backendConfigured) throw new Error('Google sign-in is not configured.');
    await db();
    const user = await local.registerUser({ sub: 'dev', email: null, name: 'Test user' }, meta);
    return { uid: user.id, email: user.email, name: user.name };
  }

  await prepareGoogleSignIn();
  let login;
  try {
    // No `scopes`: the ID token already carries name and email. Asking for
    // scopes, even these, makes the plugin demand a MainActivity change and
    // fail every login without it.
    login = await SocialLogin.login({ provider: 'google', options: {} });
  } catch (error) {
    console.warn('[VocaLock] Google sign-in failed', error);
    // The picker reports a back-press as an error whose text mentions cancel.
    if (/cancel/i.test(String((error as Error)?.message ?? error))) throw new SignInCancelled();
    throw new Error('Google sign-in failed. Try again.');
  }
  const result = login.result as {
    idToken: string | null;
    profile: { id: string | null; email: string | null; name: string | null };
  };
  if (!result.idToken) throw new Error('Google did not return an account. Try again.');

  if (!backendConfigured) {
    await db();
    // No server to verify the token against; the local stub trusts the device.
    const user = await local.registerUser(
      { sub: result.profile.id ?? 'unknown', email: result.profile.email, name: result.profile.name },
      meta,
    );
    return { uid: user.id, email: user.email, name: user.name };
  }
  return post<Session>('/auth/google', null, { idToken: result.idToken, ...meta });
}

export async function signOutRemote(session: Session): Promise<void> {
  if (GOOGLE_WEB_CLIENT_ID) {
    // So the next sign-in offers the account picker instead of reusing this one.
    // logout rejects unless the provider was initialised first.
    await prepareGoogleSignIn()
      .then(() => SocialLogin.logout({ provider: 'google' }))
      .catch(() => undefined);
  }
  if (backendConfigured && session.token) await post('/auth/signOut', session);
}

export interface PurchaseResult {
  status: 'trial' | 'active';
  validUntil: string;
  /** 'razorpay' once money moved; null for the no-payment trial. */
  provider: string | null;
}

interface StartResponse {
  checkout?: { keyId: string; subscriptionId: string; email: string | null };
}

/**
 * With Razorpay configured on the server this opens Checkout and resolves only
 * once the server has verified the payment. Throws CheckoutDismissed if the
 * user closes Checkout.
 */
export async function startSubscription(
  session: Session,
  trialDays: number,
): Promise<PurchaseResult> {
  if (!backendConfigured) {
    await db();
    const sub = await local.startTrial(session.uid, trialDays);
    return { status: 'trial', validUntil: sub.valid_until, provider: null };
  }
  const started = await post<StartResponse & Partial<PurchaseResult>>('/startSubscription', session);
  if (!started.checkout) return started as PurchaseResult; // server has no gateway configured

  // Written before leaving the app: Android may discard the app while the user
  // is in the browser and the UPI app, and this is how it finds its way back.
  await savePendingCheckout(started.checkout.subscriptionId);

  let paid;
  try {
    paid = await openSubscriptionCheckout(started.checkout);
  } catch (error) {
    if (!(error instanceof CheckoutDismissed)) throw error;
    // The redirect can be lost even when the payment went through.
    const recovered = await resumePendingCheckout(session, 3);
    if (recovered) return recovered;
    throw error;
  }
  let result: PurchaseResult;
  try {
    result = await post<PurchaseResult>('/verifySubscription', session, paid);
  } catch (error) {
    // Razorpay is the authority: if it says paid, the verify failure (a
    // network drop, a mangled redirect) does not matter.
    const settled = await resumePendingCheckout(session, 2).catch(() => null);
    if (settled) return settled;
    throw error;
  }
  await clearPendingCheckout();
  return result;
}

const KEY_PENDING = 'vocalock.pendingCheckout';
/** Razorpay lets an unpaid subscription be paid for a day (expire_by). */
const PENDING_TTL_MS = 86_400_000;

async function savePendingCheckout(subscriptionId: string): Promise<void> {
  await Preferences.set({ key: KEY_PENDING, value: JSON.stringify({ subscriptionId, at: Date.now() }) });
}

async function clearPendingCheckout(): Promise<void> {
  await Preferences.remove({ key: KEY_PENDING });
}

/**
 * Settles a checkout the app lost track of: asks the server, which asks
 * Razorpay, whether it was paid. Returns the activated plan, or null if there
 * is nothing pending or it is still unpaid.
 */
export async function resumePendingCheckout(
  session: Session,
  /**
   * How many times to ask. A UPI approval can take a few seconds to reach
   * Razorpay after the user is already back in the app, so a return from
   * checkout asks a few times; a cold start asks once.
   */
  attempts = 1,
): Promise<PurchaseResult | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => window.setTimeout(r, 2500));
    const result = await syncPendingCheckout(session);
    if (result !== 'pending') return result;
  }
  return null;
}

async function syncPendingCheckout(session: Session): Promise<PurchaseResult | null | 'pending'> {
  if (!backendConfigured || !session.token) return null;
  const raw = (await Preferences.get({ key: KEY_PENDING })).value;
  if (!raw) return null;
  let pending: { subscriptionId: string; at: number };
  try {
    pending = JSON.parse(raw);
  } catch {
    await clearPendingCheckout();
    return null;
  }
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    await clearPendingCheckout();
    return null;
  }
  let result: PurchaseResult | { status: 'pending' };
  try {
    result = await post<PurchaseResult | { status: 'pending' }>('/syncSubscription', session, {
      subscriptionId: pending.subscriptionId,
    });
  } catch (error) {
    if (error instanceof SessionExpired) throw error;
    // 400/403: not one this user can claim. Anything else: try again next launch.
    if (/belongs to someone else|Unknown subscription/.test(String((error as Error).message))) {
      await clearPendingCheckout();
    }
    return null;
  }
  if (result.status === 'pending') return 'pending';
  await clearPendingCheckout();
  return result;
}

/**
 * Hands the server the Meta ids it stamps on Conversions API events, so a
 * renewal — reported from the server, with the app closed — is credited to the
 * ad behind the install. Best effort; nothing waits on it.
 */
export async function syncMetaAttribution(session: Session): Promise<void> {
  if (!backendConfigured || !session.token) return;
  const ids = await metaAttribution();
  if (ids) await post('/me/attribution', session, ids).catch(() => undefined);
}

export interface RemoteEntitlement {
  premium: boolean;
  validUntil: string | null;
  status: 'trial' | 'active' | 'cancelled' | 'expired' | 'failed' | 'none';
  /** False once this person has had the ₹1 trial; the paywall then asks ₹199. */
  trialEligible: boolean;
}

/** Null when there is no server; the device's own record is then the truth. */
export async function getEntitlement(session: Session): Promise<RemoteEntitlement | null> {
  if (!backendConfigured) return null;
  return post<RemoteEntitlement>('/getEntitlement', session);
}

/**
 * Ends every session. The subscription is left running (only a cancel stops
 * it), and the server erases personal data only for accounts that never paid.
 * Without a server the account only ever lived on this phone, and
 * signing out removes it.
 */
export async function deleteAccount(session: Session): Promise<void> {
  if (!backendConfigured) return;
  // The version tells the server this app shows the keep-or-cancel choice.
  await post('/deleteAccount', session, { appVersion: APP_VERSION });
}

export async function cancelSubscription(session: Session): Promise<void> {
  if (!backendConfigured) {
    await db();
    await local.cancelSubscription(session.uid);
    return;
  }
  await post('/cancelSubscription', session);
}

