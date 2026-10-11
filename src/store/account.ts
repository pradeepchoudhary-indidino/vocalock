import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import {
  SessionExpired,
  cancelSubscription,
  deleteAccount,
  getEntitlement,
  resumePendingCheckout,
  signOutRemote,
  syncMetaAttribution,
  startSubscription,
  type PurchaseResult,
  type Session,
} from '../lib/api';
import type { PlanStatus } from '../db/types';
import { setCrashUser } from '../lib/crashlytics';
import { metaPurchase, metaRegistration } from '../lib/meta';

const KEY_ENTITLEMENT = 'vocalock.entitlement';
const KEY_SESSION = 'vocalock.session';

export interface Entitlement {
  /** 'none' is the app's own idle state; the rest mirror the database. */
  status: PlanStatus | 'none';
  plan: string;
  trialPrice: number;
  price: number;
  currency: string;
  /** ISO 8601, UTC. */
  startedAt: string | null;
  validUntil: string | null;
  cancelledAt: string | null;
  provider: string | null;
  /** One ₹1 trial per person; the server decides, this mirrors it for the paywall. */
  trialEligible: boolean;
}

/**
 * Pricing and trial length. Constants, mirrored in server/src/subscriptions.ts;
 * changing the renewal price also needs a new Razorpay plan.
 */
export const PRICING = {
  trialPrice: 1,
  trialDays: 1,
  /** Charged every `periodDays` after the trial. */
  renewalPrice: 199,
  periodDays: 30,
  currency: '₹',
  paywallVideoUrl: '',
};

const NO_ENTITLEMENT: Entitlement = {
  status: 'none',
  plan: 'monthly_premium',
  trialPrice: PRICING.trialPrice,
  price: PRICING.renewalPrice,
  currency: 'INR',
  startedAt: null,
  validUntil: null,
  cancelledAt: null,
  provider: null,
  trialEligible: true,
};

interface AccountState {
  session: Session | null;
  entitlement: Entitlement;
  loaded: boolean;

  hydrate: () => Promise<void>;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  /** Throws, keeping the user signed in, if the server could not delete. */
  deleteAccount: () => Promise<void>;
  /**
   * Takes payment when the server has Razorpay configured (₹1 trial or ₹199,
   * as the server decides), otherwise grants the trial straight away. Throws
   * CheckoutDismissed or the failure.
   */
  subscribe: () => Promise<void>;
  /**
   * Settles a checkout this app started but never heard back from — Android
   * may have frozen or killed the app while the user was paying. True if it
   * turned out paid and Premium is now on.
   */
  resumeCheckout: (attempts: number) => Promise<boolean>;
  applyPurchase: (result: PurchaseResult) => Promise<void>;
  /** Pulls the server's view, which is what sees renewals and failed debits. */
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const usePremium = create<AccountState>((set, get) => ({
  session: null,
  entitlement: NO_ENTITLEMENT,
  loaded: false,

  hydrate: async () => {
    const [entitlement, session] = await Promise.all([
      Preferences.get({ key: KEY_ENTITLEMENT }),
      Preferences.get({ key: KEY_SESSION }),
    ]);
    let parsed = NO_ENTITLEMENT;
    if (entitlement.value) {
      try {
        parsed = { ...NO_ENTITLEMENT, ...JSON.parse(entitlement.value) };
      } catch {
        // Corrupt value — fall back to no entitlement rather than crash.
      }
    }
    let restored: Session | null = null;
    if (session.value) {
      try {
        restored = JSON.parse(session.value) as Session;
      } catch {
        // Same: a corrupt session means signed out, not a crash.
      }
    }
    set({ entitlement: parsed, session: restored, loaded: true });
    setCrashUser(restored?.uid ?? null);
    if (restored) void syncMetaAttribution(restored);
    if (restored) {
      try {
        await get().refresh();
        // A payment the app lost track of when Android discarded it mid-checkout.
        await get().resumeCheckout(1);
      } catch (error) {
        // Revoked or expired on the server: back to Login. Anything else
        // (offline, server down) keeps the cached entitlement until next launch.
        if (error instanceof SessionExpired) await get().signOut();
      }
    }
  },

  refresh: async () => {
    const session = get().session;
    if (!session) return;
    const remote = await getEntitlement(session);
    if (!remote) return;
    const entitlement: Entitlement =
      remote.status === 'none'
        ? { ...NO_ENTITLEMENT, trialEligible: remote.trialEligible }
        : {
            ...get().entitlement,
            status: remote.status,
            validUntil: remote.validUntil,
            trialEligible: remote.trialEligible,
          };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

  signIn: async (session) => {
    if (session.created) metaRegistration();
    // `created` describes this sign-in only; it is not kept.
    const { created: _created, ...kept } = session;
    await Preferences.set({ key: KEY_SESSION, value: JSON.stringify(kept) });
    set({ session: kept });
    setCrashUser(session.uid);
    void syncMetaAttribution(kept);
  },

  signOut: async () => {
    const session = get().session;
    // Best effort: an offline sign-out still clears this phone.
    if (session) await signOutRemote(session).catch(() => undefined);
    await Promise.all([
      Preferences.remove({ key: KEY_SESSION }),
      Preferences.remove({ key: KEY_ENTITLEMENT }),
    ]);
    set({ session: null, entitlement: NO_ENTITLEMENT });
    setCrashUser(null);
  },

  deleteAccount: async () => {
    const session = get().session;
    if (session) await deleteAccount(session);
    await get().signOut();
  },

  resumeCheckout: async (attempts) => {
    const session = get().session;
    if (!session) return false;
    const recovered = await resumePendingCheckout(session, attempts);
    if (recovered) await get().applyPurchase(recovered);
    return Boolean(recovered);
  },

  applyPurchase: async (result) => {
    // The first time this purchase reaches the phone: verify, a recovery after
    // Android killed the app, and a resume can all deliver the same one.
    const isNew = get().entitlement.validUntil !== result.validUntil;
    if (isNew && result.provider) {
      if (result.status === 'trial') metaPurchase('trial', PRICING.trialPrice);
      else metaPurchase('subscribe', PRICING.renewalPrice);
    }
    const entitlement: Entitlement = {
      ...NO_ENTITLEMENT,
      status: result.status,
      startedAt: new Date().toISOString(),
      validUntil: result.validUntil,
      provider: result.provider,
      trialEligible: false,
    };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

  subscribe: async () => {
    const session = get().session;
    if (!session) throw new Error('Sign in first.');
    const result = await startSubscription(session, PRICING.trialDays);
    await get().applyPurchase(result);
  },

  cancel: async () => {
    const session = get().session;
    // Not swallowed: showing "cancelled" while the mandate still debits would
    // be the worst failure this screen could have.
    if (session) await cancelSubscription(session);
    // Cancelling ends Premium immediately, and the trial is not offered again.
    const now = new Date().toISOString();
    const entitlement: Entitlement = {
      ...get().entitlement,
      status: 'cancelled',
      cancelledAt: now,
      validUntil: now,
      trialEligible: false,
    };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

}));

/** Cancelled still counts until validUntil passes. */
export function isPremium(entitlement: Entitlement): boolean {
  if (entitlement.status === 'none' || entitlement.status === 'expired') return false;
  if (!entitlement.validUntil) return false;
  return new Date(entitlement.validUntil).getTime() > Date.now();
}

export function daysLeft(entitlement: Entitlement): number {
  if (!entitlement.validUntil) return 0;
  const ms = new Date(entitlement.validUntil).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
