import { query } from './db';

/**
 * Meta Conversions API, for the funnel events the app cannot report reliably:
 * a renewal, charged by Razorpay while the app is closed, the ₹1 trial and a
 * paid first period. All three are sent as Purchase, the event the ads optimise for.
 * 1.5 drops most trials: the entitlement refresh on returning from the UPI app
 * lands before the purchase result, so the app thinks the trial is old news.
 * Install and sign-up come from the Meta SDK in the app.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/app-events
 */
const DATASET_ID = process.env.META_DATASET_ID ?? '';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN ?? '';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v26.0';
const PACKAGE = 'com.indidino.vocalock';

export const metaConfigured = Boolean(DATASET_ID && ACCESS_TOKEN);

/** The SDK's EVENT_NAME_PURCHASED and EVENT_NAME_START_TRIAL, so server and app events read the same. */
const PURCHASE = 'fb_mobile_purchase';
const START_TRIAL = 'StartTrial';

/**
 * Reports a renewal payment. Fire and forget: a failure is logged and never
 * holds up the webhook that triggered it. `paymentId` doubles as the event id,
 * so a retried webhook that somehow got here twice is deduplicated by Meta too.
 */
export function reportRenewal(uid: string, paymentId: string, paise: number): Promise<boolean> {
  return reportAppEvent(uid, PURCHASE, `renewal:${paymentId}`, paise);
}

/**
 * Reports a ₹1 trial, as StartTrial and also as a Purchase: the ad set
 * optimises for Purchase and cannot be changed, and a trial is the conversion
 * we actually want counted. The Razorpay subscription id is in both event
 * ids, so the verify call, the webhook and a backfill describe the same events.
 */
export function reportTrial(uid: string, subscriptionId: string, paise: number, at?: Date): Promise<boolean> {
  return reportAppEvents(uid, [
    { name: START_TRIAL, id: `trial:${subscriptionId}`, paise },
    { name: PURCHASE, id: `trial-purchase:${subscriptionId}`, paise },
  ], at);
}

/**
 * Reports a paid first period (no trial) as a Purchase. The app's SDK logs one
 * too, but 1.5's refresh race skips it most of the time; until 1.6 drops the
 * app's copy, an occasional one may count twice.
 */
export function reportSubscription(uid: string, subscriptionId: string, paise: number): Promise<boolean> {
  return reportAppEvent(uid, PURCHASE, `subscribe:${subscriptionId}`, paise);
}

function reportAppEvent(uid: string, name: string, id: string, paise: number, at?: Date): Promise<boolean> {
  return reportAppEvents(uid, [{ name, id, paise }], at);
}

/** True if Meta accepted the events. Never throws. */
async function reportAppEvents(
  uid: string,
  items: { name: string; id: string; paise: number }[],
  at = new Date(),
): Promise<boolean> {
  const eventName = items.map((i) => i.name).join('+');
  if (!metaConfigured) return false;
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
    if (!user?.meta_anon_id || !user.meta_os_version) return false;
    const version = user.meta_app_version ?? '';
    const tracked = user.meta_tracking_limited === false;
    const events = items.map((item) => ({
      event_name: item.name,
      event_time: Math.floor(at.getTime() / 1000),
      action_source: 'app',
      event_id: item.id,
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
      custom_data: { currency: 'INR', value: (item.paise / 100).toFixed(2) },
    }));
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: events }) },
    );
    if (!response.ok) console.error('[meta capi]', eventName, response.status, (await response.text()).slice(0, 300));
    return response.ok;
  } catch (error) {
    console.error('[meta capi]', eventName, error);
    return false;
  }
}
