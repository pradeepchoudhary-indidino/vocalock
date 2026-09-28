import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { EyeOffIcon, LockIcon } from '../../components/Icons';
import { StepPips } from '../../components/Controls';
import { Listener } from '../../plugins';
import { useSettings } from '../../store/settings';
import { useVoiceSetup } from '../../store/voiceSetup';
import { track } from '../../lib/analytics';

/**
 * Step 2: how the phrase should lock.
 *
 * The two modes are genuinely different products, so the user picks rather than
 * being given the weaker one silently. Granting device admin means the phone's
 * own lock screen, which survives the app being force-stopped; declining means
 * a cover over the screen that a spoken phrase can lift.
 */
export function LockMode() {
  const navigate = useNavigate();
  const { lockPhrase, language } = useVoiceSetup();
  const { patch, syncService } = useSettings();
  const [asking, setAsking] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (!lockPhrase) navigate('/voice-lock/lock-phrase', { replace: true });
  }, [lockPhrase, navigate]);

  /**
   * The consent screen is a separate activity, so the answer only arrives when
   * the user comes back to us. Re-check on resume rather than trusting the
   * request to have succeeded.
   */
  const checkOnReturn = useCallback(async (): Promise<boolean> => {
    const { active } = await Listener.isDeviceLockAvailable();
    if (!active) return false;
    // Real lock screen: no unlock phrase and no backup PIN, because Android's
    // own credential is both.
    await patch({ language, lockPhrase, unlockPhrase: '', voiceLockEnabled: true });
    await syncService();
    track('voice_setup_done', { mode: 'device' });
    navigate('/voice-lock/done', { replace: true });
    return true;
  }, [language, lockPhrase, patch, syncService, navigate]);

  /**
   * The consent screen is a separate Activity, so the answer only arrives when
   * we come back. `visibilitychange` is not reliable for that in a Capacitor
   * WebView — another Activity covering us does not always fire it, which is
   * why granting admin could leave this screen sitting there as though the
   * button had done nothing. Capacitor's own appStateChange is the supported
   * signal; visibilitychange stays as a backstop.
   */
  useEffect(() => {
    if (!asking) return;
    let done = false;
    const settle = async () => {
      if (done) return;
      const granted = await checkOnReturn();
      // Back without granting: stop waiting and say so, rather than leaving the
      // button looking dead.
      if (!granted) {
        setAsking(false);
        setDeclined(true);
      } else {
        done = true;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void settle();
    };
    document.addEventListener('visibilitychange', onVisible);

    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void settle();
    }).then((h) => {
      if (done) void h.remove();
      else handle = h;
    });

    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisible);
      void handle?.remove();
    };
  }, [asking, checkOnReturn]);

  return (
    <Screen
      flow="purple"
      hero={
        <>
          <NavBar title="Lock type" right={<span className="hero__step">Step 2 of 3</span>} />
          <StepPips total={3} done={2} />
          <div className="hero__centre">
            <h1 className="hero__h1">How should it lock?</h1>
            <p className="hero__sub">You can change this later in settings.</p>
          </div>
        </>
      }
    >
      {/* Both options are laid out the same way so they can be compared. The
          difference that actually matters — whether it survives a force-stop —
          is the first line of each. */}
      <div className="option option--pick">
        <span className="option__badge">Recommended</span>
        <div className="option__head">
          <span className="option__icon">
            <LockIcon size={22} />
          </span>
          <h2 className="option__title">Use my phone&rsquo;s lock</h2>
        </div>
        <p className="option__text">
          Your phrase locks the phone for real, with its own lock screen.
        </p>
        <ul className="option__list">
          <li>
            <span className="option__mark">&#10003;</span>
            Stays locked even if VocaLock is force-stopped
          </li>
          <li>
            <span className="option__mark">&#10003;</span>
            Unlock with your fingerprint or PIN, as you always do
          </li>
          <li>
            <span className="option__mark">&#10003;</span>
            No second phrase to remember
          </li>
        </ul>
        <button
          className="btn btn--lilac"
          type="button"
          disabled={asking}
          onClick={async () => {
            setDeclined(false);
            setAsking(true);
            track('voice_setup_step', { step: 2, choice: 'device' });
            try {
              await Listener.requestDeviceLock();
            } catch {
              // The consent screen could not be opened at all — say so instead
              // of waiting for a return that will never come.
              setAsking(false);
              setDeclined(true);
            }
          }}
        >
          {asking ? 'Waiting for Android\u2026' : "Use my phone's lock"}
        </button>
        {declined ? (
          <p className="field-error" style={{ textAlign: 'left', marginTop: 10 }}>
            Android did not enable it. Tap again and choose{' '}
            <strong>Activate</strong> on the screen it shows.
          </p>
        ) : (
          <p className="price__terms" style={{ marginTop: 10 }}>
            Android will ask you to confirm. You can turn it off any time.
          </p>
        )}
      </div>

      <div className="option">
        <div className="option__head">
          <span className="option__icon option__icon--quiet">
            <EyeOffIcon size={22} />
          </span>
          <h2 className="option__title">Just cover my screen</h2>
        </div>
        <p className="option__text">
          VocaLock draws a screen over your phone, lifted by a second phrase you
          record next.
        </p>
        <ul className="option__list">
          <li>
            <span className="option__mark">&#10003;</span>
            Unlocks with your voice, no PIN needed
          </li>
          <li>
            <span className="option__mark option__mark--warn">!</span>
            A focus tool, not a lock &mdash; force-stopping VocaLock gets past it
          </li>
          <li>
            <span className="option__mark option__mark--warn">!</span>
            One more phrase to remember
          </li>
        </ul>
        <button
          className="btn btn--ghost"
          type="button"
          onClick={() => {
            track('voice_setup_step', { step: 2, choice: 'overlay' });
            navigate('/voice-lock/unlock-phrase');
          }}
        >
          Cover the screen instead
        </button>
      </div>
    </Screen>
  );
}
