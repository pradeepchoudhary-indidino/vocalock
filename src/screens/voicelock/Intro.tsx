import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { Note } from '../../components/Controls';
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

      {/* Which of these is true depends on the mode picked in the next step, so
          say both rather than the old blanket "it cannot lock your phone" — that
          stopped being accurate once device-admin locking shipped. */}
      <Note>
        <strong>You&rsquo;ll pick how it locks next.</strong> Using your phone&rsquo;s own
        lock keeps it locked even if VocaLock is force-stopped. The lighter option just
        covers the screen to keep you off the phone &mdash; handy as a focus tool, but
        anyone who force-stops VocaLock in Android settings can get past it.
      </Note>
    </Screen>
  );
}
