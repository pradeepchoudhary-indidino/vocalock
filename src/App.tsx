import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Splash } from './screens/Splash';
import { isPremium, usePremium } from './store/account';
import { Login } from './screens/Login';
import { Paywall } from './screens/Paywall';
import { Home } from './screens/Home';
import { ClapSettings } from './screens/ClapSettings';
import { Permissions } from './screens/Permissions';
import { Calibrate } from './screens/Calibrate';
import { Profile } from './screens/Profile';
import { PaymentSettings } from './screens/PaymentSettings';
import { Legal } from './screens/Legal';
import { VoiceLockIntro } from './screens/voicelock/Intro';
import { LockPhrase } from './screens/voicelock/LockPhrase';
import { LockMode } from './screens/voicelock/LockMode';
import { UnlockPhrase } from './screens/voicelock/UnlockPhrase';
import { BackupPin } from './screens/voicelock/BackupPin';
import { VoiceLockDone } from './screens/voicelock/Done';
import { VoiceLockManage } from './screens/voicelock/Manage';
import { Listener } from './plugins';
import { useSettings } from './store/settings';
import { track } from './lib/analytics';
import { initTheme, useTheme } from './lib/theme';

/** Screens that are Premium. Profile, Payment Settings and Legal stay open. */
const PREMIUM_ROUTES = /^\/(home|clap|permissions|calibrate|voice-lock)(\/|$)/;

/** Back on these exits the app rather than navigating. */
const ROOT_ROUTES = new Set(['/home', '/splash', '/login', '/paywall', '/']);

function currentPath(): string {
  return window.location.hash.replace('#', '') || '/';
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const setServiceRunning = useSettings((s) => s.setServiceRunning);
  const patch = useSettings((s) => s.patch);
  const syncService = useSettings((s) => s.syncService);
  const settingsLoaded = useSettings((s) => s.loaded);
  const listening = useSettings((s) => s.settings.clapEnabled || s.settings.voiceLockEnabled);
  const accountLoaded = usePremium((s) => s.loaded);
  const signedIn = usePremium((s) => s.session !== null);
  const premium = usePremium((s) => isPremium(s.entitlement));

  // index.html painted the theme before first paint; adopt it and start
  // following the system setting while the preference is 'auto'.
  const { mode } = useTheme();
  useEffect(initTheme, []);

  // Android can discard the WebView while the app is in the background (during
  // checkout, typically) and later restore it straight onto the last screen.
  // That skips Splash, which is what loads the session and entitlement, so a
  // cold start anywhere else goes through Splash first.
  useEffect(() => {
    if (!usePremium.getState().loaded && !['/', '/splash'].includes(currentPath())) {
      navigate('/splash', { replace: true });
    }
    // navigate is stable, so this runs once, at boot.
  }, [navigate]);

  // Premium ended — cancelled here, revoked from a UPI app, or a renewal that
  // failed: leave the Premium screens for the paywall, and switch clap-to-find
  // and voice lock off, since both keep running natively with the app closed.
  // A lock that is up stays answerable by phrase and PIN until it is lifted.
  useEffect(() => {
    if (!accountLoaded || !signedIn) return;
    if (premium) {
      // A payment settled while the paywall was up (see the checkout effect below).
      if (location.pathname === '/paywall') navigate('/home', { replace: true });
      return;
    }
    if (PREMIUM_ROUTES.test(location.pathname)) navigate('/paywall', { replace: true });
    if (settingsLoaded && listening) {
      void patch({ clapEnabled: false, voiceLockEnabled: false }).then(syncService);
    }
  }, [accountLoaded, signedIn, premium, location.pathname, settingsLoaded, listening, navigate, patch, syncService]);

  // Payments, wherever the app is when they finish. Checkout runs in Chrome and
  // the UPI app, and meanwhile Android may freeze VocaLock or kill it outright,
  // taking the screen that started checkout with it. So the app as a whole
  // listens: the return link (delivered to a fresh process too — Capacitor
  // holds it until a listener exists), and every return to the foreground,
  // settles any pending checkout by asking the server, which asks Razorpay.
  // Coming back is also when a change made elsewhere — a cancel from a UPI app,
  // a renewal or a failed one — reaches the screen.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !accountLoaded) return;
    const account = usePremium.getState;
    const handles: Promise<{ remove: () => Promise<void> }>[] = [
      CapApp.addListener('appUrlOpen', ({ url }) => {
        if (url.startsWith('com.indidino.vocalock://payment-return')) {
          void account().resumeCheckout(4).catch(() => undefined);
        }
      }),
      CapApp.addListener('resume', () => {
        if (!account().session) return;
        void account().refresh().catch(() => undefined);
        void account().resumeCheckout(3).catch(() => undefined);
      }),
    ];
    return () => handles.forEach((h) => void h.then((l) => l.remove()));
  }, [accountLoaded]);

  // Pull the window insets once the page exists.
  //
  // MainActivity also pushes these whenever they change, but that push can fire
  // before the WebView has a document — the values are then lost and every
  // screen renders under the status bar. Pulling here is what makes the first
  // paint correct; the push only has to carry later changes like the keyboard.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void Listener.getInsets().then(({ top, bottom, keyboard }) => {
      const root = document.documentElement.style;
      root.setProperty('--safe-top', `${top}px`);
      root.setProperty('--safe-bottom', `${bottom}px`);
      root.setProperty('--kb', `${keyboard}px`);
    });
  }, []);

  // Match the system-bar icons to the web theme, or they end up invisible. The
  // app is edge-to-edge, so the bars have no colour of their own: the page
  // paints behind them.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void Listener.setSystemBarStyle({ darkIcons: mode !== 'dark' });
  }, [mode]);

  // With the keyboard up the screen is much shorter, so bring whatever was
  // tapped back into view. The delay lets the IME finish animating first,
  // otherwise the scroll is computed against the old height.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.matches('input, textarea, select')) return;
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener('backButton', () => {
      if (ROOT_ROUTES.has(currentPath())) void CapApp.exitApp();
      else navigate(-1);
    }).then((h) => {
      handle = h;
    });
    return () => void handle?.remove();
  }, [navigate]);

  // Keep React's view of the service and lock honest when Kotlin changes them.
  useEffect(() => {
    const handles: { remove: () => Promise<void> }[] = [];
    void (async () => {
      handles.push(
        await Listener.addListener('serviceState', ({ running }) => setServiceRunning(running)),
      );
      handles.push(
        await Listener.addListener('lockState', ({ locked, how }) => {
          void patch({ isLocked: locked });
          if (locked) track('lock_shown');
          else if (how) track('unlock', { how });
        }),
      );
      handles.push(
        await Listener.addListener('alertFired', ({ trigger }) => track('alert_fired', { trigger })),
      );
      handles.push(
        await Listener.addListener('alertStopped', ({ how }) => track('alert_stopped', { how })),
      );
    })();
    return () => handles.forEach((h) => void h.remove());
  }, [setServiceRunning, patch]);

  return (
    <Routes key={location.pathname}>
      <Route path="/" element={<Navigate to="/splash" replace />} />
      <Route path="/splash" element={<Splash />} />
      <Route path="/login" element={<Login />} />
      <Route path="/paywall" element={<Paywall />} />
      <Route path="/home" element={<Home />} />

      <Route path="/clap" element={<ClapSettings />} />
      <Route path="/permissions" element={<Permissions />} />
      <Route path="/calibrate" element={<Calibrate />} />

      <Route path="/voice-lock" element={<VoiceLockManage />} />
      <Route path="/voice-lock/intro" element={<VoiceLockIntro />} />
      <Route path="/voice-lock/lock-phrase" element={<LockPhrase />} />
      <Route path="/voice-lock/mode" element={<LockMode />} />
      <Route path="/voice-lock/unlock-phrase" element={<UnlockPhrase />} />
      <Route path="/voice-lock/pin" element={<BackupPin />} />
      <Route path="/voice-lock/done" element={<VoiceLockDone />} />

      <Route path="/profile" element={<Profile />} />
      <Route path="/payment" element={<PaymentSettings />} />
      <Route path="/legal/:doc" element={<Legal />} />

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
