import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { track } from '../lib/analytics';
import { SignInCancelled, prepareGoogleSignIn, signInWithGoogle } from '../lib/api';
import { usePremium } from '../store/account';

/** Screen 2. Google sign-in; the account picker is the phone's own. */
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
    try {
      const session = await signInWithGoogle();
      await signIn(session);
      track('login_success', { method: 'google' });
      navigate('/paywall', { replace: true });
    } catch (err) {
      if (!(err instanceof SignInCancelled)) {
        setError(err instanceof Error ? err.message : 'Could not sign in. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      hero={
        <div className="hero__centre">
          <div className="hero-illo">&#128075;</div>
          <h1 className="hero__h1">Welcome to VocaLock</h1>
          <p className="hero__sub">Sign in so your plan stays with you.</p>
        </div>
      }
      dock={
        <>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={submit}>
            {busy ? 'Signing in…' : 'Continue with Google'}
          </button>
          <p className="price__terms" style={{ marginTop: 12 }}>
            We use your Google name and email to keep your plan with you. Nothing else.
          </p>
        </>
      }
    >
      <div className="field-error">{error}</div>
    </Screen>
  );
}
