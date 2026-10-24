import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BoltIcon, ClapIcon, LockIcon } from './Icons';

interface Slide {
  tint: 'clap' | 'lock' | 'torch';
  icon: ReactNode;
  title: string;
  sub: string;
}

/** What the card shows until an explainer video is configured. */
const SLIDES: Slide[] = [
  {
    tint: 'clap',
    icon: <ClapIcon size={44} />,
    title: 'Clap to find your phone',
    sub: 'It rings, even on silent',
  },
  {
    tint: 'lock',
    icon: <LockIcon size={40} />,
    title: 'Lock it with your voice',
    sub: 'Say your phrase. The screen locks.',
  },
  {
    tint: 'torch',
    icon: <BoltIcon size={40} />,
    title: 'Spot it in the dark',
    sub: 'Flashlight strobe and vibration',
  },
];

const SLIDE_MS = 3200;

/**
 * The paywall's media card: the explainer video when one is configured,
 * otherwise the three features as auto-advancing slides. Either way a progress
 * bar runs along the bottom, so the card reads as something playing.
 */
export function PaywallMedia({ videoUrl }: { videoUrl?: string }) {
  return (
    <div className="pw-media">
      {videoUrl ? <MediaVideo src={videoUrl} /> : <MediaSlides />}
    </div>
  );
}

function MediaSlides() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [index]);

  const slide = SLIDES[index];
  return (
    <button
      type="button"
      className="pw-media__slides"
      aria-label={`${slide.title}. ${slide.sub}`}
      onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
    >
      {/* Keyed so each slide enters with its own animation. */}
      <span key={index} className={`pw-slide pw-slide--${slide.tint}`}>
        <span className="pw-slide__badge">
          <span className="pw-slide__ring" />
          <span className="pw-slide__ring" />
          <span className="pw-slide__disc">{slide.icon}</span>
        </span>
        <span className="pw-slide__title">{slide.title}</span>
        <span className="pw-slide__sub">{slide.sub}</span>
      </span>
      <span className="pw-media__segments" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span key={s.tint} className="pw-media__segment">
            <span
              key={i === index ? `run-${index}` : 'idle'}
              className={`pw-media__fill${i < index ? ' pw-media__fill--done' : ''}${
                i === index ? ' pw-media__fill--run' : ''
              }`}
              style={{ animationDuration: `${SLIDE_MS}ms` }}
            />
          </span>
        ))}
      </span>
    </button>
  );
}

/**
 * Autoplay with sound works inside the app (Capacitor lets the WebView play
 * without a gesture), but Android can still refuse it, so a refusal falls back
 * to muted autoplay with a tap to unmute rather than a frozen first frame.
 */
function MediaVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    void (async () => {
      try {
        video.muted = false;
        await video.play();
        if (!cancelled) setMuted(false);
      } catch {
        try {
          video.muted = true;
          await video.play();
          if (!cancelled) setMuted(true);
        } catch {
          // Even muted autoplay refused; the first frame stays up.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // A video that will not load falls back to the slides, never a broken player.
  if (failed) return <MediaSlides />;

  return (
    <>
      <video
        ref={videoRef}
        className="pw-media__video"
        src={src}
        autoPlay
        loop
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0) setProgress(v.currentTime / v.duration);
        }}
      />
      {muted ? (
        <button
          type="button"
          className="pw-media__unmute"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = false;
            void video.play();
            setMuted(false);
          }}
        >
          &#128266; आवाज़ चालू करें
        </button>
      ) : null}
      <span className="pw-media__track" aria-hidden="true">
        <span className="pw-media__progress" style={{ width: `${progress * 100}%` }} />
      </span>
    </>
  );
}
