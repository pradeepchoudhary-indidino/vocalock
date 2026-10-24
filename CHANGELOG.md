# Changelog

Android releases of VocaLock (`com.indidino.vocalock`) on Google Play. Each
release is tagged `vX.Y.0` at the commit its app bundle was built from; the
version code is in brackets. Server and website changes ship with
`scripts/deploy.sh` and are listed under the release they belong to.

## 1.5.0 (7) — unreleased

- Change: the app no longer carries its speech models. Play download drops from
  ~87 MB to ~8 MB. Voice lock setup downloads the one model the user's
  language needs (English 38 MB or Hindi 44 MB) from
  `vocalock.indidino.com/models/`, resuming after drops and checking its
  SHA-256, then deletes the zip once unpacked, so the phone no longer stores
  the model twice. Upgrades from 1.4 keep their unpacked model and download
  nothing. Models are published with `scripts/publish-models.sh`. The pack
  starts downloading as soon as Premium is active (language from the phone's
  setting), so setup rarely waits on it.
- Change: checkout is Razorpay's native Android Checkout (`RazorpayPlugin`),
  inside the app with installed UPI apps as tiles, instead of the hosted page
  in a Chrome tab (kept as the fallback). The mobile number is prefilled as
  9999999999 and hidden. Server side unchanged.
- Change: paywall redesigned — brand bar with close, a media card that fills
  the free height (feature slides, or a video set on the server with
  `scripts/paywall-video.sh`, no release needed), large price, three features,
  one button. "Not now" and the trial chip removed; the close button and Back
  are the way out.
- New: product analytics. The app queues its events on the phone and sends
  them in batches to `POST /events` (source = 'app'); native events (alerts,
  locks, unlocks, wrong PINs, mic failures, service restarts, model downloads)
  are recorded while the app is closed and sent on the next open.
- In-app privacy text: says the model is downloaded once; delete-account text
  from the 2026-10-22 server change (all account data kept on delete).
- Server (deployed 2026-10-24): `GET /config` (runtime settings, read from
  `/opt/vocalock/config/app-config.json`) and `POST /events`; privacy page
  says the model is downloaded.

## 1.4.0 (6) — 2026-10-22

Sent to Play review on 2026-10-22.

- Fix: the app crashed right after a new user signed up and right after the
  ₹1 trial payment. `@capgo/capacitor-social-login` removed Meta's
  `FacebookInitProvider`, so the Meta SDK never started and logging an event
  threw. The provider is declared again in the app manifest, and `MetaPlugin`
  now skips the SDK unless it has started and never lets it crash the app.
- Fix: Meta received no events from 1.0–1.3. Installs, app opens, sign-ups,
  trials and first purchases now reach Meta, with the advertising ID.
- Fix: right after sign-in the paywall offered the ₹1 trial to accounts that
  had used it (and a paying user saw the paywall) until the app restarted.
- Change: Delete account no longer cancels the subscription; only a manual
  cancel stops the Razorpay mandate. Accounts that ever paid keep their
  identity (`users.deleted_at`, migration 006) and are restored by signing in
  again; accounts that never paid are erased. Apps older than 1.4 still get
  cancel-and-erase, which their delete screen promises.
- Privacy policy (in app and on the site) and the delete-account page say
  what deleting now does.
- Server (deployed 2026-10-22): new Razorpay webhook secret; the webhook had
  been rejected since 2026-10-10 and disabled by Razorpay since 2026-10-12.

## 1.3.0 (5) — 2026-10-15

- Fix: 1.2 crashed on every launch; R8 stripped Capacitor's plugin
  annotations. Capacitor's core is now kept.
- Fixed hero and dock on every screen; only the body scrolls. The paywall fits
  small screens, and Back on the paywall goes to Profile.

## 1.2.0 (4) — 2026-10-12

Rejected by Play (crash on launch).

- The paywall has a visible way out (the reason 1.1 was rejected).
- Meta ads measurement: install, sign-up, trial and purchases, plus the
  server's Conversions API for renewals.
- Play's edge-to-edge, large-screen and R8 recommendations.

## 1.1.0 (3) — 2026-10-10

Rejected by Play (paywall could not be dismissed).

- First public build against the hosted API at vocalock.indidino.com:
  Google sign-in, Razorpay subscriptions (₹1 trial, then ₹199 every 30 days),
  in-app account deletion, crash reporting.
- Rebuilt UI and theme (light and dark), voice and clap detection fixes, lock
  overlay rebuilt.

## 1.0.0 (1–2) — 2026-09

Internal testing only.
