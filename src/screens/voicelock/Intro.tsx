import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { Bullet, Note } from '../../components/Controls';
import { useVoiceSetup } from '../../store/voiceSetup';
import { track } from '../../lib/analytics';

/** Screen 5. */
export function VoiceLockIntro() {
  const navigate = useNavigate();
  const reset = useVoiceSetup((s) => s.reset);

  useEffect(() => {
    track('voice_setup_start');
  }, []);

  return (
    <Screen
      nav={<NavBar />}
      dock={
        <button
          className="btn btn--lilac"
          type="button"
          onClick={() => {
            reset();
            navigate('/voice-lock/lock-phrase');
          }}
        >
          Get started
        </button>
      }
    >
      <div className="hero-illo hero-illo--lilac">&#128274;</div>
      <h1 className="page-title">How Voice Lock works</h1>
      <p className="page-sub">Three things to know before you start.</p>

      <div className="bullets">
        <Bullet>
          You record <strong>two phrases</strong> &mdash; one to lock the screen, one to
          unlock it.
        </Bullet>
        <Bullet>
          You always set a <strong>backup PIN</strong>, so you can never be shut out of your
          own phone.
        </Bullet>
        <Bullet>Everything is matched on your phone. No audio is ever uploaded.</Bullet>
      </div>

      {/* The spec asks for this to be said plainly, so say it plainly. */}
      <Note tone="warn">
        <strong>This is a focus tool, not a security lock.</strong> It covers your screen to
        keep you off your phone. It cannot replace your Android lock screen, it cannot cover
        the real lock screen, and anyone who force-stops VocaLock in Android settings can get
        past it.
      </Note>
    </Screen>
  );
}
