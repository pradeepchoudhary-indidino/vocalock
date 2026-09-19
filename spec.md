# APP_NAME — Build Spec

Voice lock + clap-to-find utility app for Android. Reference app: Vokey (com.capslock.vokey).
This file is the single source of truth for Claude Code. Build in the milestone order at the bottom.

`APP_NAME` and the package id `com.COMPANY.APPNAME` are placeholders. Ask the owner before first build.

---

## 1. Product summary

Two features, one subscription.

1. **Voice Lock** — user records a lock phrase and an unlock phrase. Saying the lock phrase puts a full-screen lock over the phone. Saying the unlock phrase (or typing a backup PIN) removes it.
2. **Clap to Find** — phone listens in the background. On N claps or a whistle it rings (even on silent), vibrates and flashes the torch until stopped or until a timeout.

Positioning, stated honestly in the app: this is a convenience / focus tool, not a replacement for the Android system lock.

**Platform:** Android only, min SDK 26 (Android 8), target latest stable SDK. iOS is not possible (no overlays, no always-on background mic).

**Where we beat the reference app**
- Voice match: only the owner's voice unlocks (Phase 2, section 9)
- One shared audio pipeline, lower battery use
- Clean recovery after phone restart
- Clear trial terms and one-tap cancel

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| UI | React (web) + Vite + TypeScript, plain CSS or Tailwind |
| Native shell | Capacitor (latest stable), Android platform only. UI runs in the Capacitor WebView |
| Navigation | React Router |
| State | Zustand |
| Native | Kotlin inside `android/`, exposed to React as local Capacitor plugins (this is about half the work) |
| Firebase in the app | `@capacitor-firebase/*` plugins for Auth (native phone OTP), Analytics, Crashlytics, Remote Config. Firestore via Firebase JS SDK |
| Offline phrase spotting | Vosk Android (small English + Hindi models), restricted grammar |
| Phrase capture during setup | Android `SpeechRecognizer` |
| Auth | Firebase Auth, phone OTP |
| Database | Firestore |
| Server logic | Firebase Cloud Functions (Node, TypeScript) |
| Payments | PhonePe UPI AutoPay (subscription/mandate APIs). Follow current PhonePe docs, do not guess endpoints |
| Config | Firebase Remote Config (prices, trial length, paywall video URL) |
| Analytics / crashes | Firebase Analytics + Crashlytics |

This is a hybrid app: React web UI embedded in a native Android app. Do not use React Native, Expo or Cordova.

**Hard rule 1:** all detection, locking and alert logic must run in Kotlin with no dependency on the WebView or any JavaScript. The React side is only UI and settings. The service must keep working when the app UI is closed or killed.

**Hard rule 2:** the UI must also run in a desktop browser with `npm run dev`. Every plugin gets a web mock (section 4.1) so screens can be built and checked in Chrome without a phone.

**Hard rule 3:** use native phone OTP through the Capacitor Firebase Auth plugin. Do not use the web reCAPTCHA phone flow inside the WebView.

---

## 3. Architecture

```
React web UI (inside Capacitor WebView)
   │  (Capacitor plugin calls + plugin event listeners)
   ▼
Kotlin Capacitor plugins ── SharedPreferences (settings the service reads)
   │
   ▼
ListenerService (foreground service, type = microphone)
   ├─ AudioRecord 16 kHz mono PCM, one stream
   ├─ ClapDetector
   ├─ WhistleDetector
   └─ PhraseSpotter (Vosk)
        │
        ├─ AlertController  → AlertActivity (ring, vibrate, torch)
        └─ LockController   → LockOverlay (full-screen overlay + PIN pad)
```

One `AudioRecord` stream feeds all three detectors. Never open the mic twice.

Settings are written by React through the plugin into `SharedPreferences`. The service reads them and listens for changes. The WebView never holds the only copy (do not rely on `localStorage` for anything the service needs).

Two screens are pure Kotlin, not React, because they must appear when the WebView does not exist: the **Phone found** alert and the **Lock overlay**. Match their look to the React theme by hand.

Project layout:
```
/src            React app (screens, components, store, plugins/ wrappers + web mocks)
/android        Capacitor Android project
  app/src/main/java/.../plugins    ListenerPlugin, VoiceSetupPlugin
  app/src/main/java/.../service    ListenerService, detectors, controllers
  app/src/main/java/.../ui         AlertActivity, LockOverlay
/functions      Firebase Cloud Functions
capacitor.config.ts
```

---

## 4. Native code (Kotlin)

### 4.1 Capacitor plugins (the bridge)

Each plugin has a TypeScript wrapper in `src/plugins/` created with `registerPlugin`, plus a **web mock** used when running in a browser. The mock returns fake data: permissions all granted, a random `calibrationLevel` stream, a fake `clapDetected` every few seconds, and `testAlert()` shows a simple in-page modal.

**`ListenerPlugin`**
- `start()`, `stop()`, `isRunning(): Promise<boolean>`
- `setSettings(json)`, `getSettings(): Promise<json>`
- `testAlert()`
- `startCalibration()` / `stopCalibration()` — emits `calibrationLevel` (amplitude 0..1, ~20 per second) and `clapDetected`
- `getPermissionStatus(): Promise<{mic, notifications, batteryExempt, overlay}>`
- `requestPermission(name)`, `openBatterySettings()`, `openOverlaySettings()`
- `setPin(pin)`, `hasPin(): Promise<boolean>` — hashing happens in Kotlin, the raw PIN is never kept in JS state after the call
- Events go to React through `notifyListeners`

**`VoiceSetupPlugin`**
- `startCapture({ language })` — runs Android `SpeechRecognizer`, emits `partialTranscript` and `finalTranscript`
- `stopCapture()`
- Do not use the browser Web Speech API. It is unreliable inside the Android WebView

### 4.2 `ListenerService`
- Foreground service, `foregroundServiceType="microphone"`, persistent low-priority notification ("Listening for clap")
- Reads 20 ms PCM frames and fans them out to detectors
- Honors `onlyWhenScreenOff`: pause detectors on `ACTION_SCREEN_ON`, resume on `ACTION_SCREEN_OFF`
- **Boot:** Android 14+ blocks starting a microphone foreground service from `BOOT_COMPLETED`. On boot, post a notification "Tap to resume listening" that opens the app, which then starts the service

### 4.3 `ClapDetector`
- Track adaptive noise floor (slow moving average of frame energy)
- Candidate clap = energy jumps above `floor × k` (k from sensitivity: Low 8, Med 5, High 3), rise time under 10 ms, total burst under 100 ms, high-frequency energy ratio above threshold (rejects speech and thuds)
- Fire when `clapsRequired` candidates arrive with 150–600 ms gaps inside a 2 s window
- 3 s cooldown after firing

### 4.4 `WhistleDetector`
- FFT per frame. Whistle = single narrow peak between 1 kHz and 4 kHz, low spectral flatness, held for 300 ms or more

### 4.5 `PhraseSpotter`
- Vosk recognizer with grammar limited to the user's lock phrase, unlock phrase and `[unk]`
- Normalize text (lowercase, strip punctuation), match with small edit-distance tolerance
- Only active if voice lock is set up. When the lock is showing, only the unlock phrase is accepted

### 4.6 `LockController` + `LockOverlay`
- Full-screen `TYPE_APPLICATION_OVERLAY` window, needs `SYSTEM_ALERT_WINDOW`
- Shows clock, mic indicator, "Say your unlock phrase", and "Use PIN" → PIN pad
- 5 wrong PINs → 30 s wait
- Lock state persisted so it returns after the service restarts
- Known limits, shown in onboarding: cannot cover the system lock screen, user can force-stop the app. Do not use an Accessibility Service to work around this (Play policy)

### 4.7 `AlertController` + `AlertActivity`
- Ring: `MediaPlayer` with `USAGE_ALARM`. Save current alarm volume, set to max, restore on stop. This is how it rings on silent
- Vibrate: repeating waveform
- Torch: `CameraManager.setTorchMode` strobe at ~4 Hz
- `AlertActivity`: `setShowWhenLocked(true)`, `setTurnScreenOn(true)`. Launching it from the background is allowed because the app holds `SYSTEM_ALERT_WINDOW`
- Also post a high-priority notification with a STOP action
- Auto-stop after `alertDurationSec`, show countdown

### 4.8 `SecureStore`
- PIN stored as salted PBKDF2 hash in `EncryptedSharedPreferences`. Never store the raw PIN, never send it to the server

### Manifest permissions
`RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, `SYSTEM_ALERT_WINDOW`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `CAMERA` (torch), `WAKE_LOCK`, `INTERNET`

---

## 5. Screens (React web, except where marked native)

Visual style: light background `#F4F7FD`, white rounded cards (radius 20), primary blue gradient `#3AA0F5 → #1565C0`, dark navy text `#14213D`, Poppins font (bundled locally, not loaded from the internet), large pill buttons pinned to the bottom.

Make it feel like an app, not a website: mobile-only layout, no text selection or long-press menus, no pinch zoom, no tap highlight, respect safe-area insets, handle the Android back button through the Capacitor `App` plugin, short slide transitions between routes, status bar colored to match. All assets bundled in the app so every screen works offline. Only the paywall video streams.

1. **Splash** — check auth and entitlement, route to Login, Paywall or Home.
2. **Login** — phone number → OTP (Firebase).
3. **Paywall** — autoplay muted presenter video (URL from Remote Config), "Unlock APP_NAME Premium", big "₹{trialPrice} today", "then ₹{monthlyPrice}/month · Cancel anytime", **trial length stated in plain words**, feature bullets, payment app picker (PhonePe default), "Unlock Now" button → starts mandate flow.
4. **Home** — header with logo and profile icon. Card "Set up your voice lock" with Start setup (after setup: Voice Lock ON/OFF toggle and "Change phrases"). Section FIND MY PHONE: Clap to Find toggle, row "Settings & calibrate".
5. **Voice lock intro** — explains: two phrases, a PIN always, and the honest "focus tool, not a security lock" note. Button Get started.
6. **Step 1 Lock phrase** — mic button (idle / listening / captured states), live transcript chip, Start over, Continue. Validation: at least 2 words, error text in red if 1 word.
7. **Step 2 Unlock phrase** — same. Extra validation: must differ from lock phrase.
8. **Step 3 Backup PIN** — 4 to 6 digits, enter twice, Finish setup.
9. **Clap to Find settings** — status chip On/Off, note about restart behavior, Permissions row showing how many are missing. DETECTION card: Sensitivity Low/Med/High, Claps required stepper (1–5), Whistle detection toggle, Only when screen is off toggle. ALERT card: Ring, Vibrate, Flashlight toggles, Ringtone dropdown, Alert duration stepper (10–120 s). Buttons: Test alert, Calibrate detection.
10. **Permissions** — rows for Microphone (Required), Notifications, Battery, Draw over apps. Each shows a green tick or an Allow link. Info box about battery exemption. Done.
11. **Calibrate** — live bar graph from `calibrationLevel`, clap counter top right, "Heard a clap" label on detection, Test alert.
12. **Phone found** — native Kotlin `AlertActivity`, not React. Blue gradient, bell icon, "Phone found", Stop alert button, countdown text.
13. **Profile** — avatar, phone number, plan card, rows: Payment Settings, Privacy Policy, Terms of Service, Refund Policy, Help & Support. Sign out. Version footer.
14. **Payment Settings** — Plan, Status, Price, Valid until. Cancel subscription button → confirm sheet → calls backend.

---

## 6. Data model

### Local (SharedPreferences via `ListenerPlugin`)
```json
{
  "clapEnabled": false,
  "sensitivity": "med",
  "clapsRequired": 2,
  "whistleEnabled": true,
  "onlyWhenScreenOff": false,
  "ring": true, "vibrate": true, "flashlight": true,
  "ringtone": "default",
  "alertDurationSec": 30,
  "voiceLockEnabled": false,
  "lockPhrase": "", "unlockPhrase": "",
  "isLocked": false
}
```
PIN hash lives only in `SecureStore`.

### Firestore
- `users/{uid}`: `phone`, `createdAt`, `lastSeenAt`, `appVersion`, `deviceModel`
- `subscriptions/{uid}`: `plan` ("monthly_premium"), `status` ("trial" | "active" | "cancelled" | "expired" | "failed"), `trialPrice`, `price`, `currency`, `mandateId`, `provider` ("phonepe"), `startedAt`, `validUntil`, `cancelledAt`
- `payments/{id}`: `uid`, `amount`, `type` ("trial" | "renewal"), `status`, `providerTxnId`, `createdAt`

Security rules: a user can read only their own docs. Only Cloud Functions write `subscriptions` and `payments`.

### Remote Config
`trial_price` (1), `trial_days` (3), `monthly_price` (499), `paywall_video_url`, `paywall_enabled`

---

## 7. Backend (Cloud Functions)

- `createSubscription` (callable) — creates the PhonePe AutoPay mandate for max `monthly_price`, first debit `trial_price`. Returns the intent/redirect payload for the app
- `phonepeWebhook` (HTTPS) — verify signature, update `subscriptions` and `payments`
- `getEntitlement` (callable) — returns `{ premium: boolean, validUntil }`
- `cancelSubscription` (callable) — revokes the mandate at PhonePe, sets status `cancelled`, access stays until `validUntil`
- `renewalJob` (scheduled daily) — triggers renewal debits for subscriptions due, marks failures

App caches entitlement locally for 72 hours so the features work offline.

---

## 8. Compliance checklist (do before launch)

- **Play billing:** this app sells a digital subscription outside Google Play Billing. Check the current Google Play payments policy and the India alternative-billing program, and enroll if required, before submitting
- **Play subscription rules:** price, trial length and renewal terms must be clearly visible on the paywall. Cancel must be easy to find in-app
- **Microphone:** prominent in-app disclosure before asking for the mic, accurate Data Safety form, foreground service type declaration with a video demo for Play review
- **UPI AutoPay:** pre-debit notification rules are handled by the PSP, confirm with PhonePe during onboarding
- Privacy Policy, Terms, Refund Policy pages hosted publicly
- Audio never leaves the device. State this in the privacy policy and keep it true

---

## 9. Phase 2 — voice match (the "better" part)

- During setup, record each phrase 3 times
- Run an on-device speaker-embedding model (TFLite), store the averaged embedding in `SecureStore`
- On unlock, require both phrase match and cosine similarity above a threshold
- Setting: "Only my voice can unlock" (default on), with PIN still available as backup

---

## 10. Analytics events

`app_open`, `login_otp_sent`, `login_success`, `paywall_view`, `paywall_cta_tap`, `mandate_started`, `mandate_success`, `mandate_failed`, `voice_setup_start`, `voice_setup_step` (step), `voice_setup_done`, `clap_toggle` (on/off), `permission_result` (name, granted), `calibrate_open`, `alert_fired` (trigger: clap | whistle | test), `alert_stopped` (how: button | notification | timeout), `lock_shown`, `unlock` (how: voice | pin), `cancel_tap`, `cancel_confirmed`

All with `uid`, `app_version`, timestamps in UTC.

---

## 11. Build order

**M0 — Setup.** Vite + React + TypeScript project, add Capacitor and the Android platform, package id, router shell, theme, Firebase wired in. Two checks must pass: the UI opens in Chrome with `npm run dev`, and the same UI opens as a debug app on a real Android phone (`npm run build`, `npx cap sync android`, then run).

**M1 — Clap to Find core.** `ListenerService`, `ClapDetector`, `AlertController`, `AlertActivity`, `ListenerPlugin` with its web mock. Home and Clap to Find settings screens. No login or paywall yet. Goal: clap twice, phone rings on silent.

**M2 — Reliability.** Permissions screen, battery exemption, boot notification, `onlyWhenScreenOff`, `WhistleDetector`, Calibrate screen. Test on Xiaomi, Realme, Samsung, Vivo since these kill background apps the hardest.

**M3 — Voice Lock.** Setup flow (3 steps), `VoiceSetupPlugin`, Vosk `PhraseSpotter`, `LockOverlay`, PIN and `SecureStore`.

**M4 — Accounts and money.** Phone OTP login, Firestore, Cloud Functions, PhonePe sandbox, Paywall, Profile, Payment Settings, cancel flow, entitlement gating.

**M5 — Launch.** Analytics events, Crashlytics, policy pages, compliance checklist, Play Store listing, closed testing, release.

**M6 — Voice match (Phase 2).**

Build and check screens in Chrome first, since it is much faster. Then finish and test each milestone on a physical device before starting the next. The emulator mic is not good enough for clap detection.

---

## 12. Open decisions for the owner

1. App name and package id
2. Trial length (default here: 3 days) and whether to keep ₹1 → ₹499/month
3. Show the paywall before or after the user tries Clap to Find once
4. Languages at launch (English only, or English + Hindi)
5. Who records the paywall video
