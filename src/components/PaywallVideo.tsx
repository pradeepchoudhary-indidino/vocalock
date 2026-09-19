import { useEffect, useRef, useState } from 'react';

/** Dropped in by the owner; see public/README-video.txt. */
const BUNDLED_VIDEO = '/paywall-hi.mp4';

interface PaywallVideoProps {
  /** Remote Config override. Falls back to the bundled file when empty. */
  remoteUrl?: string;
}

/**
 * The paywall explainer.
 *
 * Autoplay with sound actually works inside the app: Capacitor calls
 * setMediaPlaybackRequiresUserGesture(false) on the WebView. Browsers still
 * refuse it, and Android can refuse too, so the play() promise is checked and we
 * fall back to muted autoplay with a tap-to-unmute control rather than showing
 * the user a frozen first frame.
 */
export function PaywallVideo({ remoteUrl }: PaywallVideoProps) {
  const src = remoteUrl || BUNDLED_VIDEO;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

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
        // Autoplay with sound refused — retry muted, which is always allowed.
        try {
          video.muted = true;
          await video.play();
          if (!cancelled) setMuted(true);
        } catch {
          // Even muted autoplay refused; the poster and controls remain.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (failed) {
    // No video supplied yet, or it could not load. Do not show a broken player.
    return <div className="paywall__video-fallback">&#127908;</div>;
  }

  return (
    <div className="paywall__video-wrap">
      <video
        ref={videoRef}
        className="paywall__video"
        src={src}
        autoPlay
        loop
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
      />
      {muted ? (
        <button
          type="button"
          className="paywall__unmute"
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
    </div>
  );
}
