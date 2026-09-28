package com.indidino.vocalock.service

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioPlaybackConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.indidino.vocalock.MainActivity
import com.indidino.vocalock.R
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * The always-on listener (spec section 4.2). One AudioRecord stream, opened
 * once, feeding every detector. Nothing here touches the WebView, so the service
 * survives the UI being closed or killed.
 *
 * ClapDetector, WhistleDetector and PhraseSpotter all read the same frame from
 * [onFrame], so the mic is opened exactly once however many features are on.
 */
class ListenerService : Service() {

    companion object {
        private const val TAG = "ListenerService"

        const val SAMPLE_RATE = 16_000

        /** 20 ms of mono 16-bit PCM — the unit every detector works in. */
        const val FRAME_SAMPLES = SAMPLE_RATE / 50

        /**
         * Frames fetched per AudioRecord.read().
         *
         * Reading one 20 ms frame at a time wakes the CPU 50 times a second,
         * and on an always-on listener those wakeups cost more than the maths
         * does. Pulling 100 ms at a time cuts that to 10 and changes nothing
         * the detectors see: the chunk is still split into 20 ms frames, each
         * with its own timestamp. The cost is up to 100 ms of extra latency
         * before an alert fires, which nobody can perceive.
         */
        const val FRAMES_PER_READ = 5

        const val CHANNEL_ID = "vocalock_listening"
        const val NOTIFICATION_ID = 4101

        const val ACTION_START = "com.indidino.vocalock.START"
        const val ACTION_STOP = "com.indidino.vocalock.STOP"
        const val ACTION_CALIBRATE_START = "com.indidino.vocalock.CALIBRATE_START"
        const val ACTION_CALIBRATE_STOP = "com.indidino.vocalock.CALIBRATE_STOP"
        const val ACTION_CHECK_START = "com.indidino.vocalock.CHECK_START"
        const val ACTION_CHECK_STOP = "com.indidino.vocalock.CHECK_STOP"

        const val EXTRA_PHRASE = "phrase"
        const val EXTRA_LANGUAGE = "language"

        /** How long setup listens for the candidate phrase before giving up. */
        private const val CHECK_TIMEOUT_MS = 8_000L

        /** Emit ~20 amplitude samples a second while calibrating. */
        private const val CALIBRATION_FRAMES_PER_EMIT = 2

        /**
         * Keep ignoring the room briefly after the phone's own audio stops, so
         * the tail of a sound (and any room echo of it) cannot register.
         */
        private const val PLAYBACK_TAIL_MS = 800L

        /** How often the audio thread re-checks isMusicActive(). ~400 ms. */
        private const val MUSIC_POLL_FRAMES = 20

        /**
         * Playback usages that come out of the phone's speaker and can be heard
         * by its own microphone. USAGE_ALARM is deliberately absent: that is our
         * own alert, which is already handled by AlertController.isActive.
         */
        private val SELF_NOISE_USAGES = setOf(
            AudioAttributes.USAGE_MEDIA,
            AudioAttributes.USAGE_GAME,
            AudioAttributes.USAGE_UNKNOWN,
            AudioAttributes.USAGE_ASSISTANT,
            AudioAttributes.USAGE_VOICE_COMMUNICATION,
        )

        @Volatile
        var isRunning = false
            private set

        /**
         * True while the capture loop actually holds an open AudioRecord.
         * Written only by the audio thread.
         */
        @Volatile
        private var micIsOpen = false

        @Volatile
        private var micYieldRequested = false

        /** Set while something else needs the microphone. */
        val isMicYielded: Boolean get() = micYieldRequested

        /**
         * Releases the microphone so another component can record, and blocks
         * until it is actually closed.
         *
         * Android will not hand the same mic to a second recorder: our
         * always-on AudioRecord silently starves anything else, which is how
         * SpeechRecognizer ends up reporting NO_SPEECH_DETECTED during voice
         * setup no matter how loudly the user talks.
         *
         * Returns true once the mic is free. Always pair with [reclaimMic].
         */
        fun yieldMic(timeoutMs: Long = 2_000): Boolean {
            if (!isRunning) return true
            micYieldRequested = true
            val deadline = SystemClock.uptimeMillis() + timeoutMs
            while (micIsOpen && SystemClock.uptimeMillis() < deadline) {
                try {
                    Thread.sleep(20)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return !micIsOpen
                }
            }
            return !micIsOpen
        }

        fun reclaimMic() {
            micYieldRequested = false
        }

        fun start(context: Context) = send(context, ACTION_START)
        fun stop(context: Context) = send(context, ACTION_STOP)
        fun startCalibration(context: Context) = send(context, ACTION_CALIBRATE_START)
        fun stopCalibration(context: Context) = send(context, ACTION_CALIBRATE_STOP)

        fun startPhraseCheck(context: Context, phrase: String, language: String) {
            val intent = Intent(context, ListenerService::class.java)
                .setAction(ACTION_CHECK_START)
                .putExtra(EXTRA_PHRASE, phrase)
                .putExtra(EXTRA_LANGUAGE, language)
            ContextCompat.startForegroundService(context.applicationContext, intent)
        }

        fun stopPhraseCheck(context: Context) = send(context, ACTION_CHECK_STOP)

        private fun send(context: Context, action: String) {
            val intent = Intent(context, ListenerService::class.java).setAction(action)
            if (action == ACTION_STOP && !isRunning) return
            ContextCompat.startForegroundService(context.applicationContext, intent)
        }
    }

    private var settings = ListenerSettings()
    private var captureThread: Thread? = null

    @Volatile
    private var capturing = false

    @Volatile
    private var calibrating = false

    /** True when only calibration or a phrase check asked for the mic. */
    @Volatile
    private var startedForCalibrationOnly = false

    /** Non-null while setup is proving Vosk can hear a candidate phrase. */
    @Volatile
    private var checkDeadline = 0L

    @Volatile
    private var screenOn = true

    /**
     * True while the phone is playing audio of its own. A clap in a video is a
     * real clap as far as the microphone is concerned, so without this the app
     * flashes and rings at its owner while they are watching something.
     */
    @Volatile
    private var selfNoisePlaying = false

    /** Elapsed-realtime millis until which self-noise suppression still holds. */
    @Volatile
    private var selfNoiseUntil = 0L

    /**
     * Second, independent read of the same question.
     *
     * getActivePlaybackConfigurations() reports other apps' players in an
     * anonymized form and can be restricted outright, so the callback alone is
     * not a signal we can rely on. isMusicActive() is available to every app and
     * answers "is the music stream playing" directly — which is exactly the case
     * that matters here, a video or a song coming out of this phone's speaker.
     */
    @Volatile
    private var musicActive = false

    private var framesSinceMusicPoll = 0

    private lateinit var audioManager: AudioManager

    private lateinit var clapDetector: ClapDetector
    private val speechGate = SpeechGate()
    private lateinit var whistleDetector: WhistleDetector

    /** Written on the arming thread, read on the audio thread. */
    @Volatile
    private var phraseSpotter: PhraseSpotter? = null

    /**
     * Guards the slow Vosk load. compareAndSet, not a plain flag: two settings
     * changes in quick succession would otherwise both pass a volatile check and
     * start two arming threads against the same recogniser.
     */
    private val preparingSpotter = java.util.concurrent.atomic.AtomicBoolean(false)

    private val prefsListener =
        SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> reloadSettings() }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_ON -> screenOn = true
                Intent.ACTION_SCREEN_OFF -> screenOn = false
            }
        }
    }

    private val playbackCallback = object : AudioManager.AudioPlaybackCallback() {
        override fun onPlaybackConfigChanged(configs: MutableList<AudioPlaybackConfiguration>) {
            updateSelfNoise(configs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        clapDetector = ClapDetector(
            onClap = { chainCount ->
                ListenerBus.emit(
                    "clapDetected",
                    JSONObject()
                        .put("count", chainCount)
                        .put("at", SystemClock.elapsedRealtime()),
                )
            },
            onFire = {
                if (!calibrating) AlertController.start(this, "clap")
            },
        )
        whistleDetector = WhistleDetector {
            if (!calibrating) AlertController.start(this, "whistle")
        }
        settings = SettingsStore.read(this)
        applySettings()
        SettingsStore.prefs(this).registerOnSharedPreferenceChangeListener(prefsListener)
        // A lock that was up when the service died must come back with it.
        LockController.restore(this)
        // And an alert that was killed mid-ring must not leave the user's alarm
        // volume pinned at maximum.
        AlertController.restoreAlarmVolumeIfStranded(this)
        audioManager.registerAudioPlaybackCallback(playbackCallback, null)
        updateSelfNoise(audioManager.activePlaybackConfigurations)
        registerReceiver(
            screenReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        startForegroundSafely()
        isRunning = true
        ListenerBus.emit("serviceState", JSONObject().put("running", true))

        when (intent?.action) {
            ACTION_STOP -> {
                stopSelfCleanly()
                return START_NOT_STICKY
            }

            ACTION_CALIBRATE_START -> {
                if (!settings.needsMic) startedForCalibrationOnly = true
                calibrating = true
            }

            ACTION_CHECK_START -> {
                val phrase = intent.getStringExtra(EXTRA_PHRASE).orEmpty()
                val language = intent.getStringExtra(EXTRA_LANGUAGE) ?: settings.language
                if (!settings.needsMic) startedForCalibrationOnly = true
                startPhraseCheck(phrase, language)
            }

            ACTION_CHECK_STOP -> finishPhraseCheck(heard = false)

            ACTION_CALIBRATE_STOP -> {
                calibrating = false
                if (startedForCalibrationOnly && !settings.needsMic) {
                    startedForCalibrationOnly = false
                    stopSelfCleanly()
                    return START_NOT_STICKY
                }
            }
        }

        startCapture()
        // Restart after an out-of-memory kill; Android re-delivers no intent, and
        // onCreate re-reads SharedPreferences, so the service comes back correct.
        return START_STICKY
    }

    override fun onDestroy() {
        stopCapture()
        phraseSpotter?.release()
        phraseSpotter = null
        VoskModels.releaseAll()
        runCatching { unregisterReceiver(screenReceiver) }
        runCatching { audioManager.unregisterAudioPlaybackCallback(playbackCallback) }
        runCatching {
            SettingsStore.prefs(this).unregisterOnSharedPreferenceChangeListener(prefsListener)
        }
        isRunning = false
        ListenerBus.emit("serviceState", JSONObject().put("running", false))
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ----- settings -----

    private fun reloadSettings() {
        settings = SettingsStore.read(this)
        applySettings()
        if (!settings.needsMic && !calibrating) stopSelfCleanly()
    }

    private fun applySettings() {
        clapDetector.thresholdFactor = settings.clapThresholdFactor
        clapDetector.clapsRequired = settings.clapsRequired
        syncPhraseSpotter()
    }

    /**
     * Vosk model loading takes seconds, so it happens off the audio thread and
     * only while voice lock is actually armed.
     */
    private fun ensureSpotter(): PhraseSpotter =
        phraseSpotter ?: PhraseSpotter(applicationContext) { target ->
            when (target) {
                PhraseSpotter.Target.LOCK -> {
                    LockController.lock(this)
                    phraseSpotter?.lockedMode = true
                }

                PhraseSpotter.Target.UNLOCK -> if (LockController.isLocked) {
                    LockController.unlockByVoice(this)
                    phraseSpotter?.lockedMode = false
                }

                PhraseSpotter.Target.CHECK -> finishPhraseCheck(heard = true)
            }
        }.also { phraseSpotter = it }

    private fun syncPhraseSpotter() {
        // A setup check owns the recogniser while it runs; re-arming underneath
        // it would cancel the very thing the user is being asked to confirm.
        if (phraseSpotter?.checking == true) return

        val wanted = settings.voiceLockEnabled && settings.lockPhrase.isNotEmpty()

        if (!wanted) {
            phraseSpotter?.release()
            return
        }
        if (!preparingSpotter.compareAndSet(false, true)) return

        val lock = settings.lockPhrase
        val unlock = settings.unlockPhrase
        val language = settings.language
        thread(name = "vocalock-vosk", isDaemon = true) {
            try {
                val spotter = ensureSpotter()
                val ok = spotter.arm(language, lock, unlock)
                spotter.lockedMode = LockController.isLocked
                if (!ok) Log.w(TAG, "phrase spotter could not be armed")
            } finally {
                preparingSpotter.set(false)
            }
        }
    }

    private fun updateSelfNoise(configs: List<AudioPlaybackConfiguration>) {
        val playing = configs.any { it.audioAttributes.usage in SELF_NOISE_USAGES }
        if (playing != selfNoisePlaying) {
            // Logged because this silently gates every detector: without it, a
            // report of "it stopped hearing my claps" is unattributable.
            Log.i(TAG, "self-noise ${if (playing) "started" else "stopped"} — detectors ${if (playing) "paused" else "resuming"}")
        }
        if (!playing && selfNoisePlaying) {
            // Start the tail only on the transition to silence.
            selfNoiseUntil = SystemClock.elapsedRealtime() + PLAYBACK_TAIL_MS
        }
        selfNoisePlaying = playing
    }

    /** True while the phone's own output could be reaching its microphone. */
    private fun isSelfNoisy(nowMs: Long): Boolean =
        selfNoisePlaying || musicActive || nowMs < selfNoiseUntil

    /** Cheap enough at ~2.5 Hz; far too expensive per 20 ms frame. */
    private fun pollMusicActive() {
        if (++framesSinceMusicPoll < MUSIC_POLL_FRAMES) return
        framesSinceMusicPoll = 0
        val active = runCatching { audioManager.isMusicActive }.getOrDefault(false)
        if (active == musicActive) return
        musicActive = active
        if (!active) selfNoiseUntil = SystemClock.elapsedRealtime() + PLAYBACK_TAIL_MS
        Log.i(TAG, "music stream ${if (active) "active — detectors paused" else "idle — detectors resuming"}")
    }

    // ----- capture -----

    private fun startCapture() {
        if (capturing) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "RECORD_AUDIO not granted; not opening the mic")
            stopSelfCleanly()
            return
        }

        capturing = true
        captureThread = thread(name = "vocalock-audio", isDaemon = true) { captureLoop() }
    }

    private fun stopCapture() {
        capturing = false
        captureThread?.join(500)
        captureThread = null
    }

    private fun captureLoop() {
        // Outer loop so the mic can be released and re-acquired without tearing
        // the service down — see yieldMic().
        while (capturing) {
            if (micYieldRequested || !wantsAudio()) {
                // Nothing needs the microphone: let go of it entirely rather
                // than holding an open stream and discarding the samples. This
                // is the difference between idling at a few percent an hour and
                // idling at nothing.
                sleepQuietly(250)
                continue
            }
            val record = openRecord() ?: return
            micIsOpen = true
            try {
                readFrames(record)
            } finally {
                micIsOpen = false
                runCatching { record.stop() }
                record.release()
            }
        }
    }

    /** Returns null when the mic cannot be opened at all; the service stops. */
    private fun openRecord(): AudioRecord? {
        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) {
            Log.e(TAG, "AudioRecord reports no usable buffer size")
            capturing = false
            return null
        }

        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuffer, FRAME_SAMPLES * 4),
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "mic permission revoked mid-flight", e)
            capturing = false
            return null
        }

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord failed to initialise")
            record.release()
            capturing = false
            return null
        }
        return record
    }

    private fun readFrames(record: AudioRecord) {
        val chunk = ShortArray(FRAME_SAMPLES * FRAMES_PER_READ)
        val frame = ShortArray(FRAME_SAMPLES)
        var framesSinceEmit = 0

        try {
            record.startRecording()
            // Detector state is stale after a gap in the audio; start clean.
            clapDetector.reset()
            whistleDetector.reset()
            speechGate.reset()

            while (capturing && !micYieldRequested && wantsAudio()) {
                val read = record.read(chunk, 0, chunk.size)
                if (read <= 0) {
                    if (read == AudioRecord.ERROR_INVALID_OPERATION) break
                    continue
                }

                val chunkEnd = SystemClock.elapsedRealtime()
                var offset = 0
                while (offset < read) {
                    val length = minOf(FRAME_SAMPLES, read - offset)
                    System.arraycopy(chunk, offset, frame, 0, length)
                    // Each frame carries the time it was actually captured, not
                    // the time the chunk arrived, so clap-chain gaps stay exact.
                    val framesAfter = (read - offset - length) / FRAME_SAMPLES
                    val frameAt = chunkEnd - framesAfter * 20L
                    framesSinceEmit++
                    onFrame(frame, length, framesSinceEmit, frameAt)
                    if (framesSinceEmit >= CALIBRATION_FRAMES_PER_EMIT) framesSinceEmit = 0
                    offset += length
                }
            }
        } catch (e: IllegalStateException) {
            Log.e(TAG, "recording stopped unexpectedly", e)
        }
    }

    /**
     * Whether anything currently needs the microphone open.
     *
     * "Only when screen is off" used to keep the stream running and merely skip
     * the maths, which saved nothing — the audio path is most of the cost.
     */
    private fun wantsAudio(): Boolean {
        if (calibrating) return true
        if (phraseSpotter?.checking == true) return true
        if (LockController.isLocked) return true
        // No unlock phrase is required: in device-lock mode there is none by
        // design, because Android's own credential is what gets you back in.
        // Demanding one here meant the mic never opened in that mode and saying
        // the lock phrase did nothing at all.
        if (settings.voiceLockEnabled && settings.lockPhrase.isNotEmpty()) return true
        if (settings.clapEnabled && !(settings.onlyWhenScreenOff && screenOn)) return true
        return false
    }

    private fun sleepQuietly(millis: Long) {
        try {
            Thread.sleep(millis)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            capturing = false
        }
    }

    /**
     * The one fan-out point. Every detector reads the same frame; the mic is
     * never opened twice (spec section 3).
     */
    private fun onFrame(frame: ShortArray, length: Int, framesSinceEmit: Int, now: Long) {
        pollMusicActive()

        if (calibrating && framesSinceEmit >= CALIBRATION_FRAMES_PER_EMIT) {
            ListenerBus.emit(
                "calibrationLevel",
                JSONObject().put("level", clapDetector.levelOf(frame, length).toDouble()),
            )
        }

        // Do not stack a second alert on a ringing one.
        val alerting = AlertController.isActive

        // onlyWhenScreenOff pauses the CLAP detectors but keeps the stream open,
        // so there is no mic-reacquire glitch when the screen goes off again. It
        // must never gate the phrase spotter: the lock screen is on by
        // definition, so gating it there would make voice unlock impossible.
        val clapPaused = settings.onlyWhenScreenOff && screenOn && !calibrating

        // Calibration deliberately ignores this: the user is holding the phone
        // and wants to see the meter react to whatever they do.
        val selfNoisy = isSelfNoisy(now) && !calibrating

        if (!alerting && !clapPaused && !selfNoisy) {
            if (settings.clapEnabled || calibrating) {
                clapDetector.accept(frame, length, now)
            }
            if (settings.clapEnabled && settings.whistleEnabled && !calibrating) {
                whistleDetector.accept(frame, length, now)
            }
        }

        // While the lock is up the spotter keeps running even if voiceLockEnabled
        // was switched off underneath us, so the user can still talk their way out.
        val spotter = phraseSpotter
        if (spotter == null || !spotter.isReady || alerting) return

        val wantsSpotting = if (spotter.checking) {
            // Setup is waiting to hear the candidate phrase.
            if (checkDeadline in 1..now) {
                finishPhraseCheck(heard = false)
                false
            } else {
                true
            }
        } else {
            !calibrating && !selfNoisy &&
                (settings.voiceLockEnabled || LockController.isLocked)
        }
        if (!wantsSpotting) return

        spotter.lockedMode = LockController.isLocked

        // Vosk's acoustic model is by far the most expensive thing here, and
        // decoding an empty room is pure waste. Only run it when the gate says
        // there is something to hear — and replay the pre-roll when it opens,
        // so the first syllable of the phrase is not lost.
        when (speechGate.update(frame, length, now)) {
            SpeechGate.Decision.SILENT -> return

            SpeechGate.Decision.OPENED -> {
                spotter.resetStream()
                // The pre-roll already ends with this frame, so feeding it is
                // the whole utterance so far — do not feed the frame again.
                val preRoll = speechGate.preRoll()
                val preRollLength = speechGate.preRollLength()
                if (preRollLength > 0) spotter.accept(preRoll, preRollLength, now)
                return
            }

            SpeechGate.Decision.OPEN -> Unit
        }
        spotter.accept(frame, length, now)
    }

    // ----- setup phrase check -----

    private fun startPhraseCheck(phrase: String, language: String) {
        if (phrase.isBlank()) {
            finishPhraseCheck(heard = false)
            return
        }
        thread(name = "vocalock-phrase-check", isDaemon = true) {
            val spotter = ensureSpotter()
            if (!spotter.armForCheck(language, phrase)) {
                Log.w(TAG, "could not arm the phrase check")
                finishPhraseCheck(heard = false)
                return@thread
            }
            // Only now start the clock. Loading a model is slow the first time
            // for a language (tens of megabytes), and starting the countdown
            // before it is ready would report "couldn't hear it" while the user
            // has not even been asked to speak yet.
            checkDeadline = SystemClock.elapsedRealtime() + CHECK_TIMEOUT_MS
        }
    }

    private fun finishPhraseCheck(heard: Boolean) {
        val spotter = phraseSpotter
        if (spotter == null || !spotter.checking) return
        checkDeadline = 0L
        spotter.release()

        ListenerBus.emit("phraseCheckResult", JSONObject().put("heard", heard))

        // Put the always-on spotter back the way the settings say it should be.
        applySettings()
        if (startedForCalibrationOnly && !settings.needsMic && !calibrating) {
            startedForCalibrationOnly = false
            stopSelfCleanly()
        }
    }

    private fun stopSelfCleanly() {
        stopCapture()
        calibrating = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    // ----- foreground notification -----

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.vl_listening_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shown while VocaLock is listening"
                setShowBadge(false)
            },
        )
    }

    private fun startForegroundSafely() {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setContentTitle(getString(R.string.vl_listening_title))
            .setContentText(getString(R.string.vl_listening_text))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // Android 12+ throws if we were started from the background without
            // an allowed reason; the boot notification path (M2) is the fix.
            Log.e(TAG, "startForeground refused", e)
            stopSelf()
        }
    }
}
