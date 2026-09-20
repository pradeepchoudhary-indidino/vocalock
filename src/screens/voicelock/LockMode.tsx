import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { Bullet, Note, StepPips } from '../../components/Controls';
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
      nav={
        <>
          <NavBar title="How should it lock?" />
          <StepPips total={3} done={2} />
        </>
      }
    >
      <div className="hero-illo hero-illo--lilac">&#128274;</div>
      <h1 className="page-title">Lock your phone, or cover it?</h1>
      <p className="page-sub">You can change this later.</p>

      <div className="card">
        <h2 className="card__title">Lock my phone properly</h2>
        <p className="card__text">
          Saying your phrase locks your phone with its own lock screen.
        </p>
        <div className="bullets" style={{ marginTop: 14 }}>
          <Bullet>Stays locked even if VocaLock is force-stopped</Bullet>
          <Bullet>Unlock with your fingerprint or PIN, as you always do</Bullet>
          <Bullet>No second phrase to remember</Bullet>
        </div>
        <div style={{ height: 16 }} />
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

      <div className="card">
        <h2 className="card__title">Just cover my screen</h2>
        <p className="card__text">
          A screen VocaLock draws over your phone, lifted by a second phrase you
          record next.
        </p>
        <Note tone="warn">
          A focus tool, not a lock. It can be got past by force-stopping VocaLock
          in Android settings.
        </Note>
        <button
          className="btn btn--quiet"
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
