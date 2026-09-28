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
export function Splash() {
  const navigate = useNavigate();
  const hydrateSettings = useSettings((s) => s.hydrate);
  const hydrateAccount = usePremium((s) => s.hydrate);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      track('app_open');
      const results = await Promise.allSettled([hydrateSettings(), hydrateAccount()]);
      results.forEach((r) => {
        if (r.status === 'rejected') console.error('[VocaLock] hydrate failed', r.reason);
      });
      if (cancelled) return;

      const { session, entitlement } = usePremium.getState();
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
