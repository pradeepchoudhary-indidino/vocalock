Drop the Hindi explainer video here as:

    paywall-hi.mp4

It plays at the top of the subscription screen and starts on its own, with sound.

What to aim for
  - H.264 (avc1) video + AAC audio in an .mp4 container. That is what the
    Android WebView plays reliably; .mkv and .webm are not safe bets.
  - Landscape-ish, roughly 16:10. It is displayed with object-fit: cover, so
    keep the presenter near the centre.
  - 20 to 40 seconds. It autoplays and loops, so a long one gets irritating.
  - A few MB at most. It is bundled into the APK, which is already large
    because of the two speech models.

Everything in public/ is copied verbatim into the build and packaged into the
app, so the video works with no network. If you would rather stream it, set
paywall_video_url in Remote Config instead and leave this file out — the screen
prefers the remote URL when one is set.
