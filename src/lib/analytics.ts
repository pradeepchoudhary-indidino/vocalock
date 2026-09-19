/**
 * Spec section 10. Firebase Analytics is wired in M5; until then events go to
 * the console with the same names and payloads, so switching the sink over is a
 * one-function change and the event list can be reviewed today.
 */
export type AnalyticsEvent =
  | 'app_open'
  | 'login_otp_sent'
  | 'login_success'
  | 'paywall_view'
  | 'paywall_cta_tap'
  | 'mandate_started'
  | 'mandate_success'
  | 'mandate_failed'
  | 'voice_setup_start'
  | 'voice_setup_step'
  | 'voice_setup_done'
  | 'clap_toggle'
  | 'permission_result'
  | 'calibrate_open'
  | 'alert_fired'
  | 'alert_stopped'
  | 'lock_shown'
  | 'unlock'
  | 'cancel_tap'
  | 'cancel_confirmed';

const APP_VERSION = '1.0.0';

export function track(event: AnalyticsEvent, params: Record<string, unknown> = {}) {
  const payload = {
    ...params,
    app_version: APP_VERSION,
    ts: new Date().toISOString(), // UTC, as the spec requires
  };
  // Stringified, not passed as an object: Android's WebView console flattens
  // objects to "[object Object]" in logcat, which makes field reports useless.
  console.info(`[analytics] ${event} ${JSON.stringify(payload)}`);
}

export { APP_VERSION };
