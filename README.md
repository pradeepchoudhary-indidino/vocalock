# VocaLock

Voice lock + clap-to-find utility for Android. Built to [`spec.md`](./spec.md).

- **App name:** VocaLock
- **Package id:** `com.indidino.vocalock`
- **Launch languages:** English and Hindi (each ships its own Vosk model)
- **Milestones done:** M0, M1, M2, M3, and M4's UI (paywall is UI-only — see below)
- **ABI:** arm64-v8a only — see the Vosk section

## Toolchain

The versions this project was set up and built against:

| | |
|---|---|
| Node | 26.9.0 |
| JDK | **21** (Capacitor 7's Android modules are compiled at source level 21 — JDK 17 fails) |
| Android SDK | platform 36, build-tools 36.0.0 |
| AGP / Gradle | 8.9.1 / 8.11.1 |
| minSdk / target | 26 / 36 |

On this machine:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
```

`android/local.properties` already points `sdk.dir` at that SDK. It is machine-local
and should stay out of version control.

## Running it

**In a browser** — every plugin call is served by the web mock in
`src/plugins/ListenerPluginWeb.ts`, so all screens work with no phone attached:

```sh
npm install
npm run dev          # http://localhost:5173
```

**On a phone:**

```sh
npm run sync         # build + npx cap sync android
npx cap open android # then run from Android Studio
```

or straight to an APK:

```sh
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Layout

```
src/
  plugins/      ListenerPlugin wrapper, TypeScript definitions, browser mock
  store/        Zustand store; writes through to SharedPreferences, never caches alone
  screens/      Splash, Login, Paywall, Home, ClapSettings, Permissions,
                Calibrate, Profile, PaymentSettings, Legal, voicelock/*
  components/   Screen shell, NavBar, controls, icons
  assets/fonts/ Poppins (woff2, bundled — never fetched at runtime)
  lib/          Firebase app init, analytics
android/app/src/main/java/com/indidino/vocalock/
  plugins/      ListenerPlugin          the bridge, no detection logic
                VoiceSetupPlugin        SpeechRecognizer, setup-time capture only
  service/      ListenerService         foreground service, one AudioRecord stream
                ClapDetector            onset / rise-time / HF-ratio clap detection
                AlertController         ring, vibrate, torch strobe, auto-stop
                SecureStore             PBKDF2 PIN hash in EncryptedSharedPreferences
                SettingsStore           the SharedPreferences document
                ListenerBus             service → plugin event channel
                WhistleDetector         FFT, narrow peak + low spectral flatness
                PhraseSpotter           Vosk, grammar limited to the two phrases
                LockController          owns lock state, survives a service restart
                BootReceiver            posts "tap to resume" after a restart
  ui/           AlertActivity           "Phone found", pure Kotlin (screen 12)
                LockOverlay             the lock screen, an overlay window not an Activity
android/vosk/   local Vosk build — see "Vosk is built here" below
```

## How detection works

`ListenerService` opens one 16 kHz mono `AudioRecord` stream and reads 20 ms frames.
Every detector reads the same frame — the mic is never opened twice.

`ClapDetector` splits each frame into 2.5 ms blocks, because a clap's defining trait
is a rise time under 10 ms and a 20 ms frame cannot resolve that. A block is a clap
candidate when it clears the adaptive noise floor by the sensitivity factor (Low 8×,
Med 5×, High 3×), peaks within 10 ms, is over within 100 ms, and carries enough
high-frequency energy to rule out speech and door thuds. `clapsRequired` candidates
with 150–600 ms gaps inside a 2 s window fire the alert, then a 3 s cooldown.

## Firebase

`src/lib/firebase.ts` initialises from `.env.local` (copy `.env.example`). It stays a
no-op until those values are filled in. Auth, Firestore and Remote Config are wired up
in M4; no `google-services.json` is needed to build today.

## Why voice lock can refuse a phrase

Setup captures phrases through Android's `SpeechRecognizer`, which knows far more
words than the bundled offline Vosk model. Record "band karo" with the English model
loaded and Vosk drops the word it does not know:

```
UpdateGrammarFst(): ["band karo", "open karo", "[unk]"]
W VoskAPI : Ignoring word missing in vocabulary: 'karo'
```

The phrase then collapses to "band", never matches, and voice lock silently never
fires. So setup now **proves the phrase before saving it**: after you record it,
`PhraseCheck` arms Vosk with that one phrase and asks you to say it again. If the model
cannot hear it, setup says so and asks for a different phrase. This catches missing
vocabulary, accent problems and homophones — all the ways the two engines can disagree.

`VoskModels` owns the models so the check and the always-on spotter share one loaded
copy rather than paying twice for ~50 MB of RAM. `LibVosk.setLogLevel(INFO)` is on, so
`adb logcat | grep VoskAPI` shows exactly why a phrase was refused.

## Vosk is built here, not pulled from Maven

**Status: fixed and verified.** All four LOAD segments in the shipped `libvosk.so` are
now `2**14` (16 KB) with correct offset/vaddr congruence, `check-16kb-alignment.py`
passes on the APK, and Android no longer shows the compatibility warning on device.

`com.alphacephei:vosk-android:0.3.47` ships a `libvosk.so` whose ELF LOAD segments are
4 KB aligned. Android 15+ and Google Play require 16 KB on 64-bit ABIs, and a prebuilt
`.so` cannot be re-aligned — the segment offsets have to be congruent to their virtual
addresses modulo 16 KB, which only a relink can arrange. Upstream fixed it on master
(`build-vosk.sh` passes `-Wl,-z,max-page-size=16384` for arm64-v8a) but has published
no release since March 2023.

So `android/vosk/` is a local library module holding our own build:

| | |
|---|---|
| `build-libvosk-arm64.sh` | the exact, repeatable build (OpenBLAS, CLAPACK, OpenFST, Kaldi, then libvosk) |
| `src/main/jniLibs/arm64-v8a/libvosk.so` | the result |
| `src/main/java/org/vosk/` | the Java bindings, vendored from the same upstream commit so native and Java cannot drift |
| `check-16kb-alignment.py` | run this on any APK/AAB before a Play upload |

To rebuild it:

```sh
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
cd android/vosk && ./build-libvosk-arm64.sh
```

Four deviations from upstream's script, each commented in place: `NO_SHARED=1` for
OpenBLAS (its shared-link test does not survive NDK 28's clang), `-DCMAKE_POLICY_VERSION_MINIMUM=3.5`
for CLAPACK (CMake 4 dropped the old minimum), and the toolchain at API 26 rather than
21 with f2c's `main.o` stripped (bionic only exports `stdin`/`stdout`/`stderr` as real
symbols from API 23, and f2c is compiled outside the Android sysroot), and forcing
`KALDI_FLAVOR := static` after configure (this Kaldi fork writes `dynamic` whatever it
is asked for, and the shared-library link pulls f2c's `main()` in and fails — nothing
consumes those `.so` files, since libvosk links the static archives).

**The app is arm64-v8a only.** That is set in both `app/build.gradle` and the vosk
module. 16 KB pages exist only on 64-bit ARM, so armeabi-v7a would not need a rebuild —
but shipping it would mean mixing a 0.3.47 binary with 0.3.75 bindings, and the
released x86_64 libraries fail the very check being fixed here (JNA's x86_64
`libjnidispatch.so` is 4 KB aligned too). The cost is that 32-bit-only phones and x86
emulators cannot install it; add `armeabi-v7a` to the arch loop in the build script if
you decide you want them back.

## What the paywall does today

By decision, the paywall is **UI only**. "Unlock Now" calls `startTrial()` in
`src/store/account.ts`, which writes a trial entitlement to device storage and routes
Home. No mandate is created, no money moves, and the payment-app picker is cosmetic.

Login is the same shape: `src/screens/Login.tsx` stores the phone number locally and
sends no code.

To make both real in M4, replace `startTrial` with the `createSubscription` callable
and swap `Login` for the Capacitor Firebase native OTP flow. No other screen changes.

## Not built yet

- **M4 proper** — Firestore, Cloud Functions, real PhonePe AutoPay, server-side
  entitlement. Entitlement is device-local and trivially resettable today.
- **M5** — Crashlytics, publicly hosted policy pages, Play listing, closed testing.
  Analytics events all fire (`src/lib/analytics.ts`) but log to console, not Firebase.
- **M6** — voice match (only-my-voice unlock).

## Battery

An always-on listener lives or dies on this, so the numbers are measured, not guessed
(CPU time from `/proc/<pid>/stat`, Pixel 8, app backgrounded):

| State | CPU |
|---|---|
| Paused — nothing wants the mic | **0.5%** of one core |
| Clap only, whistle off | 3.1% |
| Clap + whistle | 4.1% |

So the microphone being *open* is the floor, and the detectors add about 1% on top of
it. The lever that matters is therefore not faster maths, it is not listening at all:

- **`onlyWhenScreenOff` now defaults on, and genuinely releases the microphone.** It
  used to keep the stream open and merely skip the maths, which saved nothing. Roughly
  a 7x reduction while the screen is on. It also prevents claps in a video from firing
  the alert. Voice Lock is exempt — it has to keep listening.
- **Vosk runs behind a voice-activity gate** (`SpeechGate`). Its acoustic model is the
  most expensive thing in the app and decoding an empty room is waste. The gate keeps a
  400 ms pre-roll and replays it when it opens, so the first syllable of a phrase is
  never lost, and calls `resetStream()` so audio from before a silence cannot combine
  into a false match.
- **The whistle FFT now checks loudness first.** It used to transform the frame and
  *then* decide it was silence — an FFT 62 times a second on nothing.
- **Audio is read 100 ms at a time, not 20 ms.** Five times fewer CPU wakeups; each
  frame still carries its own timestamp so clap-chain gaps stay exact. Costs up to
  100 ms of extra alert latency, which is imperceptible.

An honest caveat: an A/B of the speech gate on a phone in active use was inconclusive —
ambient sound and foreground apps swamped the difference. The gate is right on
reasoning and the other numbers above are solid, but the gate's exact saving has not
been isolated.

## Tuning still owed

The detectors have been soaked against real ambient audio on a Pixel 8 but never
against a real clap or a real spoken phrase. One false alert occurred in 90 seconds
with background speech playing, so `WhistleDetector`'s `MIN_PEAK_SHARE` and
`MAX_FLATNESS` were tightened. Expect to adjust:

- `ClapDetector.MIN_HF_RATIO` and the Low/Med/High factors in `ListenerSettings`
- `WhistleDetector.MIN_PEAK_SHARE`, `MAX_FLATNESS`
- `PhraseSpotter.EDIT_TOLERANCE_PER_WORD`

Analytics lines in logcat carry the trigger, so `adb logcat | grep analytics` tells
you which detector fired.

## Before the Play submission

See spec section 8. Two items are already in the code and must not regress:

- The microphone prominent disclosure is shown before the permission prompt
  (`src/screens/Permissions.tsx`).
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is a restricted permission and needs a Play
  declaration; `ListenerPlugin.openBatterySettingsInternal()` falls back to the plain
  settings list if the direct request is unavailable.
