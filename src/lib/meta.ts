import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Meta App Events, for ads attribution. See android/.../plugins/MetaPlugin.kt.
 *
 * Installs and app opens are logged by the SDK on its own; this adds the funnel
 * events Meta's campaigns optimise for. Renewals are not here: they happen with
 * the app closed, so the server reports them through the Conversions API, using
 * the ids from attribution(). Nothing here runs in a browser, and every call is a
 * no-op on a build without a Meta App ID.
 */
interface MetaPlugin {
  logEvent(options: {
    event: 'registration' | 'trial' | 'subscribe';
    value?: number;
    currency?: string;
    method?: string;
  }): Promise<void>;
  getAttribution(): Promise<MetaAttribution>;
}

export interface MetaAttribution {
  anonId?: string;
  advertiserId?: string | null;
  trackingLimited?: boolean;
}

const Meta = registerPlugin<MetaPlugin>('Meta');
const native = Capacitor.isNativePlatform();

/** A new account, not a returning sign-in. */
export function metaRegistration(): void {
  if (native) void Meta.logEvent({ event: 'registration', method: 'google' }).catch(() => undefined);
}

/** A verified purchase: the ₹1 trial, or a paid first period. */
export function metaPurchase(kind: 'trial' | 'subscribe', rupees: number): void {
  if (native) void Meta.logEvent({ event: kind, value: rupees, currency: 'INR' }).catch(() => undefined);
}

export async function metaAttribution(): Promise<MetaAttribution | null> {
  if (!native) return null;
  try {
    const ids = await Meta.getAttribution();
    return ids.anonId ? ids : null;
  } catch {
    return null;
  }
}
