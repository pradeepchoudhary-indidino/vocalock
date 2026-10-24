import { useCallback, useEffect, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { Listener, type Language, type ModelStateEvent } from '../plugins';
import { Note } from './Controls';
import { CheckIcon } from './Icons';
import { track } from '../lib/analytics';

type Verdict = 'checking' | 'heard' | 'missed';

interface PhraseCheckProps {
  phrase: string;
  language: Language;
  onPassed: () => void;
  onRejected: () => void;
}

/**
 * Proves the offline model can recognise the phrase before it is saved.
 *
 * This exists because the two engines are different: setup captures through
 * Android's SpeechRecognizer, which handles far more words than the offline
 * Vosk model. Without this check a user can record a phrase Vosk will silently
 * drop words from, and voice lock then never fires with nothing to explain why.
 *
 * It asks the model's own vocabulary (checkVocabulary), so the phrase is said
 * once, not a second time for a listening test.
 */
export function PhraseCheck(props: PhraseCheckProps) {
  const { model, retry } = useModel(props.language);
  // Unknown for the first instant: show nothing rather than flash the
  // download screen at someone whose pack is already on the phone.
  if (model === null) return null;
  if (model.state !== 'ready') return <ModelDownload model={model} retry={retry} />;
  return <VocabularyCheck {...props} onModelMissing={retry} />;
}

/**
 * Follows the language's one-time model download. Starts it if nothing has yet
 * (setup usually starts it a step earlier, so most people never see this).
 */
function useModel(language: Language): { model: ModelStateEvent | null; retry: () => void } {
  const [model, setModel] = useState<ModelStateEvent | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Stable, because PhraseListen's check effect depends on it.
  const retry = useCallback(() => {
    track('model_download_retry', { language });
    setAttempt((n) => n + 1);
  }, [language]);

  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let live = true;
    // Set once an event lands; then it is newer than prepareModel's answer.
    let heardEvent = false;

    void (async () => {
      const h = await Listener.addListener('modelState', (event) => {
        if (event.language !== language) return;
        heardEvent = true;
        setModel(event);
      });
      if (!live) {
        void h.remove();
        return;
      }
      handle = h;
      try {
        const state = await Listener.prepareModel({ language });
        if (live && !heardEvent) setModel(state);
      } catch {
        if (live) {
          setModel({ language, state: 'failed', downloadedBytes: 0, totalBytes: 0, error: 'failed' });
        }
      }
    })();

    return () => {
      live = false;
      void handle?.remove();
    };
  }, [language, attempt]);

  // A failed download retries by itself once the phone is back online.
  useEffect(() => {
    if (model?.state !== 'failed') return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [model?.state, retry]);

  return { model, retry };
}

const MB = 1_000_000;

function ModelDownload({ model, retry }: { model: ModelStateEvent | null; retry: () => void }) {
  // Once per time the screen appears: how often people actually wait on it.
  useEffect(() => {
    track('model_download_shown');
  }, []);

  const total = model?.totalBytes ?? 0;
  const done = model?.downloadedBytes ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;

  if (model?.state === 'failed') {
    return (
      <>
        <Note tone="warn">
          {model.error === 'storage'
            ? `Your phone needs about ${Math.ceil((total * 3.2) / MB)} MB free to set up voice lock. Free some space and try again.`
            : 'Could not download the voice pack. Check your internet connection and try again.'}
        </Note>
        <button className="btn btn--lilac" type="button" onClick={retry}>
          Try again
        </button>
      </>
    );
  }

  return (
    <div className="verify">
      <p className="verify__phrase">Getting voice lock ready</p>
      <div
        className="model-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="model-progress__bar" style={{ width: `${pct}%` }} />
      </div>
      <p className="verify__state">
        {total > 0
          ? `Downloading the voice pack: ${Math.round(done / MB)} of ${Math.round(total / MB)} MB`
          : 'Checking the voice pack…'}
      </p>
      <Note>
        One-time download. After this, VocaLock listens fully offline and nothing you say
        leaves your phone.
      </Note>
    </div>
  );
}

function VocabularyCheck({
  phrase,
  language,
  onPassed,
  onRejected,
  onModelMissing,
}: PhraseCheckProps & { onModelMissing: () => void }) {
  const [verdict, setVerdict] = useState<Verdict>('checking');
  const [unknown, setUnknown] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const started = Date.now();
    track('phrase_check_start', { language });
    void (async () => {
      try {
        const result = await Listener.checkVocabulary({ phrase, language });
        if (!live) return;
        // The model went missing (storage cleared, say): back to the download
        // rather than blaming the user's words.
        if (result.missing) {
          onModelMissing();
          return;
        }
        track('phrase_check_result', {
          heard: result.known,
          unknown: result.unknown.length,
          language,
          ms: Date.now() - started,
        });
        setUnknown(result.unknown);
        setVerdict(result.known ? 'heard' : 'missed');
        if (result.known) window.setTimeout(onPassed, 700);
      } catch {
        // The check itself failed, not the phrase: do not block setup on it.
        if (live) onPassed();
      }
    })();
    return () => {
      live = false;
    };
  }, [phrase, language, onPassed, onModelMissing]);

  if (verdict === 'missed') {
    return (
      <>
        <div className="heard-box">
          <div className="heard-box__label">The phrase you recorded</div>
          <div className="heard-box__value" data-private>&ldquo;{phrase}&rdquo;</div>
        </div>

        <Note tone="warn">
          VocaLock listens <strong>offline</strong>, and{' '}
          {unknown.length === 1 ? (
            <>
              &ldquo;<span data-private>{unknown[0]}</span>&rdquo; is not a word it knows
            </>
          ) : (
            <>some of these words are not ones it knows</>
          )}
          , so it would never hear this phrase. Everyday words work best &mdash; try
          something like &ldquo;lock my phone&rdquo; or &ldquo;good night now&rdquo;.
        </Note>

        <button className="btn btn--lilac" type="button" onClick={onRejected}>
          Pick a different phrase
        </button>
      </>
    );
  }

  return (
    <div className="verify">
      <div className="mic-field">
        <div className="mic-btn mic-btn--captured" style={{ pointerEvents: 'none' }}>
          {verdict === 'heard' ? <CheckIcon size={52} /> : <span className="spinner" />}
        </div>
      </div>

      <div className="verify__phrase" data-private>&ldquo;{phrase}&rdquo;</div>

      {verdict === 'heard' ? (
        <span className="verify__ok">
          <CheckIcon size={18} />
          VocaLock can hear this phrase
        </span>
      ) : (
        <p className="verify__state">Checking your phrase…</p>
      )}
    </div>
  );
}
