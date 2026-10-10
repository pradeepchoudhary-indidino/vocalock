import { Capacitor } from '@capacitor/core';
import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics';

/**
 * Crash reporting for the WebView half of the app.
 *
 * Native crashes — Kotlin in the listener service, C++ in Vosk — are caught by
 * the Crashlytics SDK on its own; nothing here is needed for those. This file
 * adds what the SDK cannot see: uncaught JavaScript errors, the signed-in user,
 * and a breadcrumb trail of analytics events leading up to a crash.
 *
 * Everything is a no-op in the browser and in a build without
 * google-services.json, where every plugin call rejects.
 */
let enabled = false;
/** Kept so a sign-in restored before init finishes is still attached. */
let currentUid: string | null = null;

export async function initCrashReporting(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // The probe is a real log line rather than isEnabled(), which the Android
    // plugin does not implement. It rejects when Firebase was never initialised.
    await FirebaseCrashlytics.log({ message: 'webview_start' });
  } catch {
    return; // Firebase not configured in this build
  }
  enabled = true;

  setCrashUser(currentUid);
  window.addEventListener('error', (event) => reportError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason));
}

export function reportError(error: unknown): void {
  if (!enabled) return;
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error);
  FirebaseCrashlytics.recordException({ message }).catch(() => undefined);
}

/** The app's own uid, never an email or name: Crashlytics data is not for PII. */
export function setCrashUser(uid: string | null): void {
  currentUid = uid;
  if (!enabled) return;
  FirebaseCrashlytics.setUserId({ userId: uid ?? '' }).catch(() => undefined);
}

export function crashBreadcrumb(message: string): void {
  if (!enabled) return;
  FirebaseCrashlytics.log({ message }).catch(() => undefined);
}
