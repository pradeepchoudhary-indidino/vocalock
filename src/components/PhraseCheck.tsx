import { useEffect, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { Listener, type Language } from '../plugins';
import { MicIcon } from './Icons';

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
        <div className="hero-illo hero-illo--peach">&#128533;</div>
        <h1 className="page-title">Couldn&rsquo;t hear that one</h1>
        <p className="page-sub">
          VocaLock listens offline, and its offline vocabulary is smaller than your
          keyboard&rsquo;s. Pick a phrase with more everyday words, or switch the language.
        </p>
        <div className="card">
          <div className="row" style={{ borderBottom: 0 }}>
            <div className="row__main">
              <div className="row__sub">You said</div>
              <div className="row__label">&ldquo;{phrase}&rdquo;</div>
            </div>
          </div>
        </div>
        <button className="btn btn--lilac" type="button" onClick={onRejected}>
          Try a different phrase
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">
        {verdict === 'heard' ? 'Got it' : 'Say it once more'}
      </h1>
      <p className="page-sub">
        {verdict === 'heard'
          ? 'VocaLock can hear that phrase.'
          : 'Checking VocaLock can really hear it when it is listening offline.'}
      </p>

      <div
        className={`mic-btn${verdict === 'listening' ? ' mic-btn--listening' : ' mic-btn--captured'}`}
        style={{ pointerEvents: 'none' }}
      >
        <MicIcon size={46} />
      </div>
      <div className="mic-hint">&ldquo;{phrase}&rdquo;</div>

      {verdict === 'heard' ? (
        <div className="heard heard--show" style={{ marginTop: 18 }}>
          Heard it &#10003;
        </div>
      ) : null}
    </>
  );
}
