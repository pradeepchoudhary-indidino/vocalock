import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { Note } from '../../components/Controls';
import { Listener } from '../../plugins';
import { useSettings } from '../../store/settings';

/** Confirmation after setup, with a safe way to see the lock before trusting it. */
export function VoiceLockDone() {
  const navigate = useNavigate();
  const settings = useSettings((s) => s.settings);

  return (
    <Screen
      dock={
        <>
          <button className="btn btn--lilac" type="button" onClick={() => void Listener.lock()}>
            Try it now
          </button>
          <button className="text-btn" type="button" onClick={() => navigate('/home', { replace: true })}>
            Done
          </button>
        </>
      }
    >
      <div className="hero-illo hero-illo--mint">&#127881;</div>
      <h1 className="page-title">Voice Lock is armed</h1>
      <p className="page-sub">Your phrases are saved on this phone.</p>

      <div className="card">
        <div className="row">
          <div className="row__main">
            <div className="row__sub">Lock phrase</div>
            <div className="row__label">&ldquo;{settings.lockPhrase}&rdquo;</div>
          </div>
        </div>
        {settings.unlockPhrase ? (
          <div className="row">
            <div className="row__main">
              <div className="row__sub">Unlock phrase</div>
              <div className="row__label">&ldquo;{settings.unlockPhrase}&rdquo;</div>
            </div>
          </div>
        ) : (
          <div className="row">
            <div className="row__main">
              <div className="row__sub">To unlock</div>
              <div className="row__label">Your fingerprint or PIN</div>
            </div>
          </div>
        )}
      </div>

      <Note>
        {settings.unlockPhrase
          ? 'Try it now raises the lock so you can see it. Say your unlock phrase, or use your backup PIN, to clear it.'
          : 'Try it now locks your phone for real. Unlock it the way you normally do.'}
      </Note>
    </Screen>
  );
}
