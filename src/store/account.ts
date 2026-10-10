import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import {
  SessionExpired,
  cancelSubscription,
  deleteAccount,
  getEntitlement,
  signOutRemote,
  startSubscription,
  type Session,
} from '../lib/api';
import type { PlanStatus } from '../db/types';
import { setCrashUser } from '../lib/crashlytics';
import { CheckoutDismissed } from '../lib/razorpay';

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
}

/**
 * Pricing and trial length. These come from Firebase Remote Config in M4; the
 * shape here matches so swapping the source touches nothing else.
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
   * Takes payment when the server has Razorpay configured, otherwise grants
   * the trial straight away. Throws CheckoutDismissed or the failure.
   */
  startTrial: () => Promise<void>;
  /** Pulls the server's view, which is what sees renewals and failed debits. */
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Clears the local entitlement. M4 replaces this with a real sign-out. */
  reset: () => Promise<void>;
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
    if (restored) {
      try {
        await get().refresh();
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
        ? NO_ENTITLEMENT
        : { ...get().entitlement, status: remote.status, validUntil: remote.validUntil };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

  signIn: async (session) => {
    await Preferences.set({ key: KEY_SESSION, value: JSON.stringify(session) });
    set({ session });
    setCrashUser(session.uid);
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

  startTrial: async () => {
    const session = get().session;
    if (!session) throw new Error('Sign in first.');
    let result;
    try {
      result = await startSubscription(session, PRICING.trialDays);
    } catch (error) {
      if (!(error instanceof CheckoutDismissed)) throw error;
      // The tab can close before its redirect reaches the app even though the
      // payment went through; the webhook will have recorded it by then.
      await new Promise((r) => window.setTimeout(r, 2000));
      await get()
        .refresh()
        .catch(() => undefined);
      if (isPremium(get().entitlement)) return;
      throw error;
    }
    const entitlement: Entitlement = {
      ...NO_ENTITLEMENT,
      status: result.status,
      startedAt: new Date().toISOString(),
      validUntil: result.validUntil,
      provider: result.provider,
    };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

  cancel: async () => {
    const session = get().session;
    // Not swallowed: showing "cancelled" while the mandate still debits would
    // be the worst failure this screen could have.
    if (session) await cancelSubscription(session);
    // Access is kept until validUntil, as the spec's cancel flow requires.
    const entitlement: Entitlement = {
      ...get().entitlement,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

  reset: async () => {
    await Preferences.remove({ key: KEY_ENTITLEMENT });
    set({ entitlement: NO_ENTITLEMENT });
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
