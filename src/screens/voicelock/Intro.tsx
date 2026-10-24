import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
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
    <Screen flow="purple"
      hero={
        <>
          <NavBar />
          <div className="hero__centre">
            <div className="hero-illo">&#128274;</div>
            <h1 className="hero__h1">How Voice Lock works</h1>
            <p className="hero__sub">Three things to know before you start.</p>
          </div>
        </>
      }
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
      <div className="card">
        <ol className="numbered">
          <li>
            <span className="numbered__n">1</span>
            <span>
              You record <strong>two phrases</strong> &mdash; one to lock the screen, one to
              unlock it.
            </span>
          </li>
          <li>
            <span className="numbered__n">2</span>
            <span>
              You always set a <strong>backup PIN</strong>, so you can never be shut out of
              your own phone.
            </span>
          </li>
          <li>
            <span className="numbered__n">3</span>
            <span>
              Everything is matched <strong>on your phone</strong>. No audio is ever uploaded.
            </span>
          </li>
        </ol>
      </div>
    </Screen>
  );
}
