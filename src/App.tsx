import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Splash } from './screens/Splash';
import { Login } from './screens/Login';
import { Otp } from './screens/Otp';
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
import { initTheme, THEME_BG, useTheme } from './lib/theme';

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

  // index.html painted the theme before first paint; adopt it and start
  // following the system setting while the preference is 'auto'.
  const { mode } = useTheme();
  useEffect(initTheme, []);

  // Match the native status bar to the web theme, or its icons end up invisible.
  // Capacitor's Style.Dark means a dark bar with light icons.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({ style: mode === 'dark' ? Style.Dark : Style.Light });
    void StatusBar.setBackgroundColor({ color: THEME_BG[mode] });
  }, [mode]);

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
      <Route path="/otp" element={<Otp />} />
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
