import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { StepPips } from '../../components/Controls';
import { Listener } from '../../plugins';
import { useSettings } from '../../store/settings';
import { useVoiceSetup } from '../../store/voiceSetup';
import { track } from '../../lib/analytics';

const MIN = 4;
const MAX = 6;

/** Screen 8, step 3 of 3. */
export function BackupPin() {
  const navigate = useNavigate();
  const { language, lockPhrase, unlockPhrase, reset } = useVoiceSetup();
  const { patch, syncService } = useSettings();

  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Once setup is committed the store is cleared, which would otherwise make
  // the guard below fire and bounce us back to step 1 instead of the done screen.
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    if (committed) return;
    if (!lockPhrase || !unlockPhrase) navigate('/voice-lock/lock-phrase', { replace: true });
  }, [committed, lockPhrase, unlockPhrase, navigate]);

  const current = stage === 'enter' ? first : second;
  const setCurrent = stage === 'enter' ? setFirst : setSecond;

  const press = (digit: string) => {
    setError('');
    if (current.length >= MAX) return;
    setCurrent(current + digit);
  };

  const back = () => {
    setError('');
    setCurrent(current.slice(0, -1));
  };

  const advance = async () => {
    if (stage === 'enter') {
      if (first.length < MIN) {
        setError(`Use at least ${MIN} digits.`);
        return;
      }
      setStage('confirm');
      return;
    }

    if (first !== second) {
      setError('Those did not match. Try again.');
      setSecond('');
      setStage('enter');
      setFirst('');
      return;
    }

    setBusy(true);
    try {
      // Hashing happens in Kotlin; the raw PIN is dropped as soon as this returns.
      await Listener.setPin({ pin: first });
      await patch({ language, lockPhrase, unlockPhrase, voiceLockEnabled: true });
      await syncService();
      setFirst('');
      setSecond('');
      setCommitted(true);
      reset();
      track('voice_setup_done');
      navigate('/voice-lock/done', { replace: true });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not save your PIN.');
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

  return (
    <Screen flow="purple"
      hero={
        <>
          <NavBar title="Backup PIN" />
          <StepPips total={3} done={3} />
        </>
      }
      dock={
        <button
          className="btn btn--lilac"
          type="button"
          disabled={current.length < MIN || busy}
          onClick={advance}
        >
          {stage === 'enter' ? 'Continue' : 'Finish setup'}
        </button>
      }
    >
      <h1 className="page-title">
        {stage === 'enter' ? 'Pick a backup PIN' : 'Enter it once more'}
      </h1>
      <p className="page-sub">
        {stage === 'enter'
          ? `${MIN} to ${MAX} digits. This always unlocks, even if your voice does not.`
          : 'Just to be sure you will remember it.'}
      </p>

      <div className="pin-dots">
        {Array.from({ length: MAX }, (_, i) => (
          <span key={i} className={`pin-dot${i < current.length ? ' pin-dot--filled' : ''}`} />
        ))}
      </div>

      <div className="field-error">{error}</div>

      <div className="pin-pad">
        {keys.map((key) => {
          if (key === 'clear') {
            return (
              <button
                key={key}
                type="button"
                className="pin-key"
                style={{ fontSize: 14, fontWeight: 600 }}
                onClick={() => setCurrent('')}
              >
                Clear
              </button>
            );
          }
          if (key === 'back') {
            return (
              <button key={key} type="button" className="pin-key" aria-label="Delete" onClick={back}>
                &#9003;
              </button>
            );
          }
          return (
            <button key={key} type="button" className="pin-key" onClick={() => press(key)}>
              {key}
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
