import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { BoltIcon, ClapIcon, GoogleG, LockIcon, LogoMark, ShieldIcon } from '../components/Icons';
import { track } from '../lib/analytics';
import { SignInCancelled, prepareGoogleSignIn, signInWithGoogle } from '../lib/api';
import { usePremium } from '../store/account';

const FEATURES = [
  {
    tone: 'clap',
    icon: <ClapIcon size={19} />,
    title: 'Clap to find your phone',
    sub: 'It rings, even on silent',
  },
  {
    tone: 'lock',
    icon: <LockIcon size={18} />,
    title: 'Lock it with your voice',
    sub: 'Your own phrase, with a PIN as backup',
  },
  {
    tone: 'torch',
    icon: <BoltIcon size={18} />,
    title: 'Spot it in the dark',
    sub: 'Flashlight strobe and vibration',
  },
  {
    tone: 'offline',
    icon: <ShieldIcon size={18} />,
    title: 'Private by design',
    sub: 'Audio never leaves your phone',
  },
] as const;

/**
 * Screen 2. Google sign-in; the account picker is the phone's own.
 *
 * The button follows Google's sign-in branding (white, the four-colour G,
 * "Continue with Google") rather than the app's blue primary, so it reads as
 * Google's and not as a paywall action.
 */
export function Login() {
  const navigate = useNavigate();
  const signIn = usePremium((s) => s.signIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // On the web Google's script has to be loaded before the tap.
    prepareGoogleSignIn().catch((err) => console.warn('[VocaLock] Google init failed', err));
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    track('login_tap', { method: 'google', retry: error !== '' });
    try {
      const session = await signInWithGoogle();
      await signIn(session);
      track('login_success', { method: 'google', new_user: session.created === true });
      navigate('/paywall', { replace: true });
    } catch (err) {
      if (err instanceof SignInCancelled) {
        track('login_cancelled', { method: 'google' });
      } else {
        track('login_failed', {
          method: 'google',
          message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
        setError(err instanceof Error ? err.message : 'Could not sign in. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      hero={
        <div className="hero__centre login-hero">
          <span className="paywall-mark">
            <span className="paywall-mark__ring" />
            <span className="paywall-mark__ring" />
            <span className="paywall-mark__tile">
              <LogoMark size={52} tone="#1669C5" />
            </span>
          </span>
          <h1 className="hero__h1">Welcome to VocaLock</h1>
          <p className="hero__sub login-hero__sub">Lock it with your voice. Find it with a clap.</p>
        </div>
      }
      dock={
        <>
          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="btn btn--google" type="button" disabled={busy} onClick={submit}>
            {busy ? (
              <>
                <span className="spinner spinner--sm" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <GoogleG size={22} />
                Continue with Google
              </>
            )}
          </button>
          <p className="login-legal">
            By continuing you agree to our{' '}
            <button type="button" className="login-legal__link" onClick={() => navigate('/legal/terms')}>
              Terms
            </button>{' '}
            and{' '}
            <button type="button" className="login-legal__link" onClick={() => navigate('/legal/privacy')}>
              Privacy Policy
            </button>
            .
          </p>
        </>
      }
    >
      <div className="card login-card">
        <ul className="login-features">
          {FEATURES.map((f) => (
            <li key={f.title} className="login-feature">
              <span className={`bullet__tick bullet__tick--${f.tone}`}>{f.icon}</span>
              <span>
                <span className="login-feature__title">{f.title}</span>
                <span className="login-feature__sub">{f.sub}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="login-card__note">
          Sign in once so your plan follows you to a new phone. We only see your name and email.
        </p>
      </div>
    </Screen>
  );
}
