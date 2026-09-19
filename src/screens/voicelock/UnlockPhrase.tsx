import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { StepPips } from '../../components/Controls';
import { PhraseCapture } from '../../components/PhraseCapture';
import { PhraseCheck } from '../../components/PhraseCheck';
import { normalizePhrase, tooSimilar, useVoiceSetup, wordCount } from '../../store/voiceSetup';
import { track } from '../../lib/analytics';

/** Screen 7, step 2 of 3. */
export function UnlockPhrase() {
  const navigate = useNavigate();
  const { language, lockPhrase, unlockPhrase, setUnlockPhrase } = useVoiceSetup();
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);

  // Landing here without step 1 (deep link, reload) should not half-save.
  useEffect(() => {
    if (!lockPhrase) navigate('/voice-lock/lock-phrase', { replace: true });
  }, [lockPhrase, navigate]);

  const onCaptured = useCallback(
    (text: string) => {
      setUnlockPhrase(text);
      setTouched(true);
    },
    [setUnlockPhrase],
  );

  const words = wordCount(unlockPhrase);
  const same =
    unlockPhrase !== '' && normalizePhrase(unlockPhrase) === normalizePhrase(lockPhrase);
  // Not just "different" — different ENOUGH. Two phrases a couple of edits
  // apart cannot be told apart once they are being matched against imperfect
  // speech recognition.
  const confusable = unlockPhrase !== '' && !same && tooSimilar(unlockPhrase, lockPhrase);
  const tooShort = touched && unlockPhrase !== '' && words < 2;
  const canContinue = unlockPhrase !== '' && words >= 2 && !same && !confusable;

  const startOver = () => {
    setUnlockPhrase('');
    setTouched(false);
    setChecking(false);
  };

  const nav = (
    <>
      <NavBar title="Unlock phrase" />
      <StepPips total={3} done={2} />
    </>
  );

  if (checking) {
    return (
      <Screen nav={nav}>
        <PhraseCheck
          phrase={unlockPhrase}
          language={language}
          onPassed={() => {
            track('voice_setup_step', { step: 2 });
            navigate('/voice-lock/pin');
          }}
          onRejected={startOver}
        />
      </Screen>
    );
  }

  return (
    <Screen
      nav={nav}
      dock={
        <button
          className="btn btn--lilac"
          type="button"
          disabled={!canContinue}
          onClick={() => setChecking(true)}
        >
          Continue
        </button>
      }
    >
      <h1 className="page-title">Now your unlock phrase</h1>
      <p className="page-sub">Saying this clears the lock. Make it different from the first.</p>

      <PhraseCapture
        captured={unlockPhrase}
        onCaptured={onCaptured}
        onStartOver={startOver}
      />

      <div className="field-error">
        {same
          ? 'This is the same as your lock phrase. Pick a different one.'
          : confusable
            ? `Too close to “${lockPhrase}” — VocaLock would mix them up. Pick something that sounds clearly different.`
            : tooShort
              ? 'Use at least two words so it is not triggered by accident.'
              : ''}
      </div>
    </Screen>
  );
}
