import { useEffect, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { BulbIcon, CheckIcon, MicIcon } from './Icons';
import { VoiceSetup } from '../plugins';
import { deviceSpeechTag } from '../lib/language';

type Phase = 'idle' | 'listening' | 'captured';

interface PhraseCaptureProps {
  onCaptured: (text: string) => void;
  captured: string;
  onStartOver: () => void;
}

/**
 * The mic button plus live transcript used by setup steps 1 and 2.
 * Capture runs through Android's SpeechRecognizer via VoiceSetupPlugin.
 */
export function PhraseCapture({
  onCaptured,
  captured,
  onStartOver,
}: PhraseCaptureProps) {
  const [phase, setPhase] = useState<Phase>(captured ? 'captured' : 'idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const handles: PluginListenerHandle[] = [];
    let live = true;

    void (async () => {
      const onPartial = await VoiceSetup.addListener('partialTranscript', ({ text }) =>
        setPartial(text),
      );
      const onFinal = await VoiceSetup.addListener('finalTranscript', ({ text }) => {
        setPartial('');
        setPhase('captured');
        onCaptured(text);
      });
      const onError = await VoiceSetup.addListener('captureError', ({ message }) => {
        setPartial('');
        setPhase('idle');
        setError(message);
      });
      if (!live) {
        void onPartial.remove();
        void onFinal.remove();
        void onError.remove();
        return;
      }
      handles.push(onPartial, onFinal, onError);
    })();

    return () => {
      live = false;
      void VoiceSetup.stopCapture();
      handles.forEach((h) => void h.remove());
    };
  }, [onCaptured]);

  const start = async () => {
    if (phase === 'listening') {
      await VoiceSetup.stopCapture();
      setPhase('idle');
      return;
    }
    setError('');
    setPartial('');
    setPhase('listening');
    try {
      // The device's own language decides how we listen; the script that comes
      // back then decides which offline model spots it.
      await VoiceSetup.startCapture({ language: deviceSpeechTag() });
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Could not start listening');
    }
  };

  const hint =
    phase === 'listening'
      ? 'Listening… tap to stop'
      : phase === 'captured'
        ? 'Tap the mic to record it again'
        : 'Tap the mic and say your phrase';

  return (
    <>
      {/* The mic sits in a ring of its own: a pale disc behind it, and two
          expanding rings while it is idle so it reads as "tap me". */}
      <div className="mic-field">
        {phase === 'idle' ? (
          <>
            <span className="mic-ring" />
            <span className="mic-ring" />
          </>
        ) : null}
        <button
          type="button"
          className={`mic-btn${phase === 'listening' ? ' mic-btn--listening' : ''}${
            phase === 'captured' ? ' mic-btn--captured' : ''
          }`}
          aria-label={phase === 'listening' ? 'Stop listening' : 'Start listening'}
          onClick={start}
        >
          {phase === 'captured' ? <CheckIcon size={52} /> : <MicIcon size={46} />}
        </button>
      </div>

      <div className="mic-hint">{hint}</div>

      <div className="transcript">
        {captured ? (
          <div className="transcript__chip">
            <span className="transcript__text">&ldquo;{captured}&rdquo;</span>
            <button
              className="transcript__redo"
              type="button"
              onClick={() => {
                setPartial('');
                setPhase('idle');
                onStartOver();
              }}
            >
              Start over
            </button>
          </div>
        ) : (
          <div
            className={`transcript__empty${partial ? ' transcript__empty--partial' : ''}`}
          >
            {partial || 'Your phrase will show here'}
          </div>
        )}
      </div>

      {error ? <div className="field-error">{error}</div> : null}

      <span className="tip">
        <span className="tip__icon">
          <BulbIcon size={15} />
        </span>
        Two or three words work best
      </span>
    </>
  );
}
