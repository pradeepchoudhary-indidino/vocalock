import { useEffect, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { Listener, type Language } from '../plugins';
import { Note } from './Controls';
import { CheckIcon, MicIcon } from './Icons';

type Verdict = 'listening' | 'heard' | 'missed';

interface PhraseCheckProps {
  phrase: string;
  language: Language;
  onPassed: () => void;
  onRejected: () => void;
}

/**
 * Proves the offline model can actually recognise the phrase before it is
 * saved.
 *
 * This exists because the two engines are different: setup captures through
 * Android's SpeechRecognizer, which handles far more words than the bundled
 * Vosk model. Without this check a user can record a phrase Vosk will silently
 * drop words from, and voice lock then never fires with nothing to explain why.
 */
export function PhraseCheck({ phrase, language, onPassed, onRejected }: PhraseCheckProps) {
  const [verdict, setVerdict] = useState<Verdict>('listening');

  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let live = true;

    void (async () => {
      const h = await Listener.addListener('phraseCheckResult', ({ heard }) => {
        setVerdict(heard ? 'heard' : 'missed');
        if (heard) window.setTimeout(onPassed, 700);
      });
      if (!live) {
        void h.remove();
        return;
      }
      handle = h;
      try {
        await Listener.startPhraseCheck({ phrase, language });
      } catch {
        setVerdict('missed');
      }
    })();

    return () => {
      live = false;
      void Listener.stopPhraseCheck();
      void handle?.remove();
    };
  }, [phrase, language, onPassed]);

  if (verdict === 'missed') {
    return (
      <>
        <div className="heard-box">
          <div className="heard-box__label">The phrase you recorded</div>
          <div className="heard-box__value">&ldquo;{phrase}&rdquo;</div>
        </div>

        <Note tone="warn">
          VocaLock listens <strong>offline</strong>, and its offline vocabulary is smaller
          than your keyboard&rsquo;s. Everyday words work best &mdash; try something like
          &ldquo;lock my phone&rdquo; or &ldquo;good night now&rdquo;.
        </Note>

        <button className="btn btn--lilac" type="button" onClick={onRejected}>
          Pick a different phrase
        </button>
      </>
    );
  }

  return (
    <div className="verify">
      {/* The same mic the user just recorded with, so the two steps read as one
          flow rather than as a test that appeared from nowhere. */}
      <div className="mic-field">
        {verdict === 'listening' ? (
          <>
            <span className="mic-ring" />
            <span className="mic-ring" />
          </>
        ) : null}
        <div
          className={`mic-btn${verdict === 'listening' ? ' mic-btn--listening' : ' mic-btn--captured'}`}
          style={{ pointerEvents: 'none' }}
        >
          {verdict === 'heard' ? <CheckIcon size={52} /> : <MicIcon size={46} />}
        </div>
      </div>

      <div className="verify__phrase">&ldquo;{phrase}&rdquo;</div>

      {verdict === 'heard' ? (
        <span className="verify__ok">
          <CheckIcon size={18} />
          VocaLock heard it
        </span>
      ) : (
        <p className="verify__state">
          Say it out loud now, the way you normally would.
        </p>
      )}
    </div>
  );
}
