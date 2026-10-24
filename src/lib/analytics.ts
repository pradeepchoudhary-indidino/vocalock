import { Capacitor } from '@capacitor/core';
import { crashBreadcrumb } from './crashlytics';
import { Listener } from '../plugins';

/**
 * Product analytics (spec section 10).
 *
 * Events go to our own server (`POST /events`, the `events` table with
 * source = 'app'), next to the ones the server logs itself. They are queued on
 * the phone and sent in batches, so a tap never waits on the network and
 * nothing is lost offline or when Android kills the app: the queue is in
 * localStorage until the server has it.
 *
 * Every event carries the install's anon_id (stable until the app data is
 * cleared, so the pre-sign-in funnel joins up with the account it becomes), a
 * session_id, the current screen and the app version. Native events — alerts,
 * locks, unlocks, service restarts, which mostly happen with the app closed —
 * are recorded by NativeEvents.kt and drained into this queue on the next flush.
 *
 * Every tap on a button, link, toggle or option is recorded too (`tap`, with
 * its label and screen), and time spent per screen (`screen_leave`), so a user's
 * whole path through the app can be replayed from the events table.
 *
 * Never put the user's phrases, PIN or anything they typed in props. Tap labels
 * come from data-track, then aria-label, then the visible text with anything
 * under [data-private] removed; the PIN keypad is labelled pin_key.
 */
export type AnalyticsEvent =
  // lifecycle
  | 'app_open'
  | 'app_foreground'
  | 'app_background'
  | 'screen_view'
  | 'screen_leave'
  | 'tap'
  | 'js_error'
  // sign-in
  | 'login_tap'
  | 'login_success'
  | 'login_failed'
  | 'login_cancelled'
  | 'sign_out'
  // paywall and checkout
  | 'paywall_view'
  | 'paywall_cta_tap'
  | 'paywall_dismiss'
  | 'mandate_started'
  | 'mandate_success'
  | 'mandate_failed'
  // voice lock setup
  | 'voice_setup_start'
  | 'voice_setup_step'
  | 'voice_setup_done'
  | 'phrase_capture_start'
  | 'phrase_captured'
  | 'phrase_capture_error'
  | 'phrase_rejected'
  | 'phrase_check_start'
  | 'phrase_check_result'
  | 'model_download_shown'
  | 'model_download_retry'
  | 'pin_set'
  | 'lock_try_it'
  | 'voice_lock_toggle'
  | 'voice_lock_reset'
  // clap to find
  | 'clap_toggle'
  | 'clap_setting_change'
  | 'test_alert'
  | 'calibrate_open'
  | 'calibrate_done'
  // permissions
  | 'permission_request'
  | 'permission_result'
  // profile and account
  | 'theme_change'
  | 'delete_account_tap'
  | 'delete_account_confirmed'
  | 'cancel_tap'
  | 'cancel_confirmed'
  | 'cancel_abandoned';

const APP_VERSION = '1.5.0';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const QUEUE_KEY = 'vocalock.analytics.queue';
const ANON_KEY = 'vocalock.analytics.anon';
/** Oldest events are dropped beyond this; a phone offline for weeks. */
const QUEUE_CAP = 1000;
const BATCH = 100;
const FLUSH_EVERY_MS = 15_000;
/** A return after this long in the background starts a new session. */
const SESSION_GAP_MS = 30 * 60_000;

interface QueuedEvent {
  event: string;
  ts: number;
  props: Record<string, unknown>;
}

let token: string | null = null;
let queue: QueuedEvent[] = load();
let flushing = false;
let sessionId = newId();
let backgroundedAt = 0;

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// localStorage can throw (storage full, disabled): analytics must never break
// the app, so every access is guarded and falls back to memory.
function load(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Kept in memory; sent if the app lives long enough.
  }
}

const anonId: string = (() => {
  try {
    const existing = localStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const fresh = newId();
    localStorage.setItem(ANON_KEY, fresh);
    return fresh;
  } catch {
    return newId();
  }
})();

function currentScreen(): string {
  return window.location.hash.replace('#', '').split('?')[0] || '/';
}

function enqueue(event: string, props: Record<string, unknown>, ts = Date.now()) {
  queue.push({
    event,
    ts,
    props: {
      ...props,
      anon_id: anonId,
      session_id: sessionId,
      // Native events say screen: null — they happened outside the app.
      screen: 'screen' in props ? props.screen : currentScreen(),
      platform: Capacitor.getPlatform(),
    },
  });
  if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP);
  save();
}

export function track(event: AnalyticsEvent, params: Record<string, unknown> = {}) {
  enqueue(event, params);
  // Stringified, not passed as an object: Android's WebView console flattens
  // objects to "[object Object]" in logcat, which makes field reports useless.
  console.info(`[analytics] ${event} ${JSON.stringify(params)}`);
  // The events double as the trail a crash report shows leading up to it.
  crashBreadcrumb(event);
  if (queue.length >= 20) void flush();
}

/** The signed-in session, so events are attributed to the account. */
export function setAnalyticsToken(next: string | null) {
  token = next;
}

/** Pulls what native code recorded while the WebView was not around. */
async function drainNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { events } = await Listener.drainNativeEvents();
    for (const e of events) enqueue(e.event, { ...e.props, native: true, screen: null }, e.ts);
  } catch {
    // An older native shell without the method; nothing to drain.
  }
}

/** Sends the queue in batches. Safe to call often; only one runs at a time. */
export async function flush(): Promise<void> {
  if (flushing || !API_BASE) return;
  flushing = true;
  try {
    await drainNative();
    while (queue.length > 0) {
      const batch = queue.slice(0, BATCH);
      const response = await fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ appVersion: APP_VERSION, events: batch }),
        keepalive: true,
      });
      if (!response.ok) break; // keep them; the next flush tries again
      queue = queue.slice(batch.length);
      save();
    }
  } catch {
    // Offline or the server is down: they stay queued.
  } finally {
    flushing = false;
  }
}

// ---- screens and taps ------------------------------------------------------

let currentScreenPath: string | null = null;
let screenEnteredAt = 0;

/**
 * Called on every route change: closes the previous screen with the time spent
 * on it, then opens the new one.
 */
export function enterScreen(path: string) {
  if (path === currentScreenPath) return;
  const from = currentScreenPath;
  if (from !== null) track('screen_leave', { screen: from, ms: Date.now() - screenEnteredAt, to: path });
  currentScreenPath = path;
  screenEnteredAt = Date.now();
  track('screen_view', { screen: path, from });
}

const TAPPABLE = [
  'button',
  'a',
  'select',
  'label',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[data-track]',
].join(',');

function tapLabel(el: Element): string {
  const named = el.getAttribute('data-track') ?? el.getAttribute('aria-label');
  if (named) return named.trim().slice(0, 60);
  if (el.closest('[data-private]')) return 'private';
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[data-private], input, textarea').forEach((n) => n.remove());
  const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  return el.tagName.toLowerCase();
}

function onTap(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  const el = target?.closest(TAPPABLE);
  if (!el) return;
  const props: Record<string, unknown> = { label: tapLabel(el), kind: el.tagName.toLowerCase() };
  // For a toggle, the state it was switched to (the click has not landed yet,
  // so the current state is the one being left).
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    props.on = !el.checked;
  } else if (el.getAttribute('aria-checked') !== null) {
    props.on = el.getAttribute('aria-checked') !== 'true';
  } else if (el.getAttribute('aria-pressed') !== null) {
    props.on = el.getAttribute('aria-pressed') !== 'true';
  }
  if ((el as HTMLButtonElement).disabled) props.disabled = true;
  track('tap', props);
}

/**
 * Starts the periodic flush and the lifecycle events. Called once at boot.
 * Background/foreground also bound sessions: a long absence is a new session.
 */
export function initAnalytics() {
  window.setInterval(() => void flush(), FLUSH_EVERY_MS);
  // Capture phase: recorded even when a handler stops the click from bubbling.
  document.addEventListener('click', onTap, { capture: true, passive: true });

  window.addEventListener('error', (e) => {
    track('js_error', { message: String(e.message).slice(0, 200), source: 'error' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    track('js_error', { message: reason.slice(0, 200), source: 'promise' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      backgroundedAt = Date.now();
      // The screen they left the app from, and how long they had been on it.
      if (currentScreenPath !== null) {
        track('screen_leave', {
          screen: currentScreenPath,
          ms: Date.now() - screenEnteredAt,
          to: 'background',
        });
      }
      track('app_background');
      void flush();
    } else if (backgroundedAt > 0) {
      // Time in the background is not time on the screen.
      screenEnteredAt = Date.now();
      const away = Date.now() - backgroundedAt;
      if (away > SESSION_GAP_MS) sessionId = newId();
      track('app_foreground', { away_ms: away, new_session: away > SESSION_GAP_MS });
    }
  });

  void flush();
}

export { APP_VERSION };
