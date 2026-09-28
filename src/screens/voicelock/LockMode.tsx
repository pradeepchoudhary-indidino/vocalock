import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  useEffect(() => {
    if (!lockPhrase) navigate('/voice-lock/lock-phrase', { replace: true });
  }, [lockPhrase, navigate]);

  /**
   * The consent screen is a separate activity, so the answer only arrives when
   * the user comes back to us. Re-check on resume rather than trusting the
   * request to have succeeded.
   */
  const checkOnReturn = useCallback(async () => {
    const { active } = await Listener.isDeviceLockAvailable();
    if (!active) return;
    // Real lock screen: no unlock phrase and no backup PIN, because Android's
    // own credential is both.
    await patch({ language, lockPhrase, unlockPhrase: '', voiceLockEnabled: true });
    await syncService();
    track('voice_setup_done', { mode: 'device' });
    navigate('/voice-lock/done', { replace: true });
  }, [language, lockPhrase, patch, syncService, navigate]);

  useEffect(() => {
    if (!asking) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkOnReturn();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
          onClick={() => {
            setAsking(true);
            track('voice_setup_step', { step: 2, choice: 'device' });
            void Listener.requestDeviceLock();
          }}
        >
          Use my phone&rsquo;s lock
        </button>
        <p className="price__terms" style={{ marginTop: 10 }}>
          Android will ask you to confirm. You can turn it off any time.
        </p>
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
