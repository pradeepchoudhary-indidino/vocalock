import { query } from './db';

/**
 * Meta Conversions API, for the one funnel event the app cannot report itself:
 * a renewal, charged by Razorpay while the app is closed. Install, sign-up,
 * trial and first purchase come from the Meta SDK in the app, so the two never
 * report the same event.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/app-events
 */
const DATASET_ID = process.env.META_DATASET_ID ?? '';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN ?? '';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v26.0';
const PACKAGE = 'com.indidino.vocalock';

export const metaConfigured = Boolean(DATASET_ID && ACCESS_TOKEN);

/** The SDK's EVENT_NAME_PURCHASED, so server and app events read the same. */
const PURCHASE = 'fb_mobile_purchase';

/**
 * Reports a renewal payment. Fire and forget: a failure is logged and never
 * holds up the webhook that triggered it. `paymentId` doubles as the event id,
 * so a retried webhook that somehow got here twice is deduplicated by Meta too.
 */
export async function reportRenewal(uid: string, paymentId: string, paise: number): Promise<void> {
  if (!metaConfigured) return;
  try {
    const [user] = await query<{
      meta_anon_id: string | null;
      meta_advertiser_id: string | null;
      meta_tracking_limited: boolean | null;
      meta_os_version: string | null;
      meta_device_model: string | null;
      meta_app_version: string | null;
    }>(
      `SELECT meta_anon_id, meta_advertiser_id, meta_tracking_limited,
              meta_os_version, meta_device_model, meta_app_version
       FROM users WHERE id = $1;`,
      [uid],
    );
    // Without an install id Meta cannot tie the event to anyone, and without
    // the Android version it rejects the event.
    if (!user?.meta_anon_id || !user.meta_os_version) return;
    const version = user.meta_app_version ?? '';
    const tracked = user.meta_tracking_limited === false;
    const event = {
      event_name: PURCHASE,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'app',
      event_id: `renewal:${paymentId}`,
      user_data: {
        anon_id: user.meta_anon_id,
        ...(tracked && user.meta_advertiser_id ? { madid: user.meta_advertiser_id } : {}),
      },
      app_data: {
        advertiser_tracking_enabled: tracked ? 1 : 0,
        application_tracking_enabled: 1,
        // All 16 positions, in order: version, package, app short and long
        // version, Android version, model, locale, timezone abbreviation,
        // carrier, screen width, height, density, cores, storage, free
        // storage, timezone. Unknown ones are empty.
        extinfo: ['a2', PACKAGE, version, version, user.meta_os_version, user.meta_device_model ?? '',
          'en_IN', '', '', '', '', '', '', '', '', 'Asia/Kolkata'],
      },
      custom_data: { currency: 'INR', value: (paise / 100).toFixed(2) },
    };
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [event] }) },
    );
    if (!response.ok) console.error('[meta capi]', response.status, (await response.text()).slice(0, 300));
  } catch (error) {
    console.error('[meta capi]', error);
  }
}
