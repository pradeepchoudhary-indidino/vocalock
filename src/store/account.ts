import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import { cancelSubscription, startSubscription, type Session } from '../lib/api';
import type { PlanStatus } from '../db/types';

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
  trialDays: 3,
  monthlyPrice: 499,
  currency: '₹',
  paywallVideoUrl: '',
};

const NO_ENTITLEMENT: Entitlement = {
  status: 'none',
  plan: 'monthly_premium',
  trialPrice: PRICING.trialPrice,
  price: PRICING.monthlyPrice,
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
  /** Paywall is UI-only for now: this grants the trial straight away. */
  startTrial: (provider: string) => Promise<void>;
  cancel: () => Promise<void>;
  /** Clears the local entitlement. M4 replaces this with a real sign-out. */
  reset: () => Promise<void>;
}

function addDays(days: number): string {
  const until = new Date();
  until.setUTCDate(until.getUTCDate() + days);
  return until.toISOString();
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
  },

  signIn: async (session) => {
    await Preferences.set({ key: KEY_SESSION, value: JSON.stringify(session) });
    set({ session });
  },

  signOut: async () => {
    await Promise.all([
      Preferences.remove({ key: KEY_SESSION }),
      Preferences.remove({ key: KEY_ENTITLEMENT }),
    ]);
    set({ session: null, entitlement: NO_ENTITLEMENT });
  },

  startTrial: async (provider) => {
    // With a backend configured this is where the real mandate is created; the
    // local write below then just mirrors what the server returned.
    const session = get().session;
    const remote = session
      ? await startSubscription(session, PRICING.trialDays).catch(() => null)
      : null;
    const entitlement: Entitlement = {
      ...NO_ENTITLEMENT,
      status: 'trial',
      startedAt: new Date().toISOString(),
      validUntil: remote?.validUntil ?? addDays(PRICING.trialDays),
      provider,
    };
    await Preferences.set({ key: KEY_ENTITLEMENT, value: JSON.stringify(entitlement) });
    set({ entitlement });
  },

  cancel: async () => {
    const session = get().session;
    if (session) await cancelSubscription(session).catch(() => undefined);
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
