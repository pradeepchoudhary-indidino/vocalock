import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../store/settings';
import { isPremium, usePremium } from '../store/account';
import { track } from '../lib/analytics';
import { LogoMark } from '../components/Icons';

/**
 * Screen 1. Loads settings, session and entitlement, then routes:
 * signed out → Login, signed in without premium → Paywall, otherwise Home.
 */
/** Android version and model, from the WebView's user agent. */
function deviceInfo() {
  const ua = navigator.userAgent;
  return {
    android: /Android ([\d.]+)/.exec(ua)?.[1] ?? null,
    model: /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1]?.trim() ?? null,
    lang: navigator.language,
  };
}

export function Splash() {
  const navigate = useNavigate();
  const hydrateSettings = useSettings((s) => s.hydrate);
  const hydrateAccount = usePremium((s) => s.hydrate);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const opened = Date.now();
      const results = await Promise.allSettled([hydrateSettings(), hydrateAccount()]);
      results.forEach((r) => {
        if (r.status === 'rejected') console.error('[VocaLock] hydrate failed', r.reason);
      });
      if (cancelled) return;

      const { session, entitlement } = usePremium.getState();
      const { settings } = useSettings.getState();
      // The state each launch starts from: who, paying or not, what is armed.
      track('app_open', {
        signed_in: session !== null,
        premium: isPremium(entitlement),
        trial_eligible: entitlement.trialEligible,
        clap_on: settings.clapEnabled,
        voice_lock_on: settings.voiceLockEnabled,
        language: settings.language,
        hydrate_ms: Date.now() - opened,
        ...deviceInfo(),
      });
      if (!session) navigate('/login', { replace: true });
      else if (!isPremium(entitlement)) navigate('/paywall', { replace: true });
      else navigate('/home', { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateSettings, hydrateAccount, navigate]);

  return (
    <div className="splash" data-flow="blue">
      <div className="splash__mark">
        <LogoMark size={56} tone="#1669C5" />
      </div>
      <div className="spinner" />
    </div>
  );
}
