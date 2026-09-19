import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { StepPips } from '../../components/Controls';
import { PhraseCapture } from '../../components/PhraseCapture';
import { PhraseCheck } from '../../components/PhraseCheck';
import { detectLanguage } from '../../lib/language';
import { useVoiceSetup, wordCount } from '../../store/voiceSetup';
import { track } from '../../lib/analytics';

/** Screen 6, step 1 of 3. */
export function LockPhrase() {
  const navigate = useNavigate();
  const { language, lockPhrase, setLanguage, setLockPhrase } = useVoiceSetup();
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);

  const onCaptured = useCallback(
    (text: string) => {
      // The script decides the model: Devanagari needs the Hindi one. No picker
      // — the user already told us which language they speak by speaking it.
      setLanguage(detectLanguage(text));
      setLockPhrase(text);
      setTouched(true);
    },
    [setLanguage, setLockPhrase],
  );

  const startOver = useCallback(() => {
    setLockPhrase('');
    setTouched(false);
    setChecking(false);
  }, [setLockPhrase]);

  const tooShort = touched && lockPhrase !== '' && wordCount(lockPhrase) < 2;
  const canContinue = lockPhrase !== '' && wordCount(lockPhrase) >= 2;

  const nav = (
    <>
      <NavBar title="Lock phrase" />
      <StepPips total={3} done={1} />
    </>
  );

  if (checking) {
    return (
      <Screen nav={nav}>
        <PhraseCheck
          phrase={lockPhrase}
          language={language}
          onPassed={() => {
            track('voice_setup_step', { step: 1 });
            navigate('/voice-lock/unlock-phrase');
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
      <h1 className="page-title">Say your lock phrase</h1>
      <p className="page-sub">
        Saying this locks your screen. Pick something you would not say by accident.
      </p>



      <PhraseCapture
        captured={lockPhrase}
        onCaptured={onCaptured}
        onStartOver={startOver}
      />

      <div className="field-error">
        {tooShort ? 'Use at least two words so it is not triggered by accident.' : ''}
      </div>
    </Screen>
  );
}
