import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { LockIcon, MicIcon } from '../../components/Icons';
import { Note } from '../../components/Controls';
import { Listener } from '../../plugins';
import { useSettings } from '../../store/settings';

/** Confirmation after setup, with a safe way to see the lock before trusting it. */
export function VoiceLockDone() {
  const navigate = useNavigate();
  const settings = useSettings((s) => s.settings);

  return (
    <Screen
      flow="purple"
      hero={
        <div className="hero__centre">
          <div className="hero-illo">&#127881;</div>
          <h1 className="hero__h1">Voice Lock is armed</h1>
          <p className="hero__sub">Your phrases are saved on this phone.</p>
        </div>
      }
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
      <div className="phrase-pair">
        <div className="phrase-card">
          <span className="phrase-card__icon">
            <LockIcon size={17} />
          </span>
          <span className="phrase-card__label">Lock phrase</span>
          <span className="phrase-card__value">&ldquo;{settings.lockPhrase}&rdquo;</span>
        </div>
        <div className="phrase-card">
          <span className="phrase-card__icon phrase-card__icon--alt">
            <MicIcon size={17} />
          </span>
          <span className="phrase-card__label">
            {settings.unlockPhrase ? 'Unlock phrase' : 'To unlock'}
          </span>
          <span className="phrase-card__value">
            {settings.unlockPhrase
              ? `\u201c${settings.unlockPhrase}\u201d`
              : 'Fingerprint or PIN'}
          </span>
        </div>
      </div>

      <Note>
        {settings.unlockPhrase
          ? 'Try it now raises the lock so you can see it. Say your unlock phrase, or use your backup PIN, to clear it.'
          : 'Try it now locks your phone for real. Unlock it the way you normally do.'}
      </Note>
    </Screen>
  );
}
