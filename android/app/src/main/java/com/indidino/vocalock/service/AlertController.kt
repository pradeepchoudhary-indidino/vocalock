package com.indidino.vocalock.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.indidino.vocalock.R
import com.indidino.vocalock.ui.AlertActivity
import org.json.JSONObject

/**
 * Rings, vibrates and strobes the torch (spec section 4.7). Entirely native: it
 * runs with no WebView attached and is driven by the service or by testAlert().
 */
object AlertController {

    private const val TAG = "AlertController"
    const val CHANNEL_ID = "vocalock_alert"
    const val NOTIFICATION_ID = 4102
    const val ACTION_STOP = "com.indidino.vocalock.STOP_ALERT"

    private val handler = Handler(Looper.getMainLooper())

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var torchId: String? = null
    private var torchOn = false

    /**
     * Alarm volume before we raised it, so it can be put back exactly.
     *
     * Also written to disk: if the process dies mid-alert — a crash, a
     * force-stop, an out-of-memory kill — an in-memory copy is lost and the
     * user's alarm volume stays at maximum forever, with nothing to tell them
     * why their morning alarm is now deafening. [restoreAlarmVolumeIfStranded]
     * puts it back on the next start.
     */
    private var savedAlarmVolume: Int? = null

    private const val PREFS_ALERT = "vocalock_alert"
    private const val KEY_STRANDED_VOLUME = "strandedAlarmVolume"

    private var strobeRunnable: Runnable? = null
    private var timeoutRunnable: Runnable? = null
    private var tickRunnable: Runnable? = null

    @Volatile
    var isActive = false
        private set

    /** Seconds left before the alert gives up, for the countdown on screen. */
    @Volatile
    var secondsLeft = 0
        private set

    fun start(context: Context, trigger: String) {
        val app = context.applicationContext
        if (isActive) return
        isActive = true

        val settings = SettingsStore.read(app)
        secondsLeft = settings.alertDurationSec

        ensureChannel(app)
        postNotification(app)

        if (settings.ring) startRing(app, settings.ringtone)
        if (settings.vibrate) startVibrate(app)
        if (settings.flashlight) startTorch(app)

        // Allowed from the background because the app holds SYSTEM_ALERT_WINDOW.
        runCatching {
            app.startActivity(
                Intent(app, AlertActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_NO_USER_ACTION,
                ),
            )
        }.onFailure { Log.w(TAG, "could not show AlertActivity", it) }

        timeoutRunnable = Runnable { stop(app, "timeout") }.also {
            handler.postDelayed(it, settings.alertDurationSec * 1000L)
        }
        tickRunnable = object : Runnable {
            override fun run() {
                if (!isActive) return
                secondsLeft = (secondsLeft - 1).coerceAtLeast(0)
                AlertActivity.onTick(secondsLeft)
                handler.postDelayed(this, 1_000L)
            }
        }.also { handler.postDelayed(it, 1_000L) }

        ListenerBus.emit("alertFired", JSONObject().put("trigger", trigger))
    }

    fun stop(context: Context, how: String) {
        val app = context.applicationContext
        if (!isActive) return
        isActive = false

        timeoutRunnable?.let { handler.removeCallbacks(it) }
        tickRunnable?.let { handler.removeCallbacks(it) }
        strobeRunnable?.let { handler.removeCallbacks(it) }
        timeoutRunnable = null
        tickRunnable = null
        strobeRunnable = null

        stopRing(app)
        stopVibrate()
        stopTorch(app)

        NotificationManagerCompatSafe.cancel(app, NOTIFICATION_ID)
        AlertActivity.onStopped()

        ListenerBus.emit("alertStopped", JSONObject().put("how", how))
    }

    // ----- ring -----

    private fun startRing(context: Context, ringtone: String) {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        // This is what makes it audible on silent: the alarm stream ignores the
        // ringer mode, and we take it to full for the duration of the alert.
        val previous = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        savedAlarmVolume = previous
        // Persist before raising, not after: a crash in between is exactly the
        // case this protects against.
        alertPrefs(context).edit().putInt(KEY_STRANDED_VOLUME, previous).apply()
        runCatching {
            audio.setStreamVolume(
                AudioManager.STREAM_ALARM,
                audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                0,
            )
        }.onFailure { Log.w(TAG, "could not raise alarm volume", it) }

        runCatching {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(context, ringtoneUri(ringtone))
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Log.w(TAG, "could not start ringtone", it) }
    }

    /**
     * Ringtone choices map onto sounds already present on the device, so the
     * alert needs no bundled audio and works with no network. Custom recorded
     * tones are part of the launch polish (M5).
     */
    private fun ringtoneUri(ringtone: String): Uri {
        val type = when (ringtone) {
            "siren" -> RingtoneManager.TYPE_RINGTONE
            "chime", "beep" -> RingtoneManager.TYPE_NOTIFICATION
            else -> RingtoneManager.TYPE_ALARM
        }
        return RingtoneManager.getDefaultUri(type)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: Uri.parse("content://settings/system/alarm_alert")
    }

    private fun stopRing(context: Context) {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null

        savedAlarmVolume?.let { volume ->
            val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, volume, 0) }
        }
        savedAlarmVolume = null
        alertPrefs(context).edit().remove(KEY_STRANDED_VOLUME).apply()
    }

    private fun alertPrefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_ALERT, Context.MODE_PRIVATE)

    /**
     * Puts the alarm volume back if a previous run was killed while ringing.
     * Called on service start; a no-op in the normal case.
     */
    fun restoreAlarmVolumeIfStranded(context: Context) {
        if (isActive) return
        val prefs = alertPrefs(context)
        val stranded = prefs.getInt(KEY_STRANDED_VOLUME, -1)
        if (stranded < 0) return

        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, stranded, 0) }
            .onSuccess { Log.i(TAG, "restored alarm volume to $stranded after an interrupted alert") }
        prefs.edit().remove(KEY_STRANDED_VOLUME).apply()
    }

    // ----- vibrate -----

    private fun startVibrate(context: Context) {
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager)
                .defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator = v
        if (!v.hasVibrator()) return
        val pattern = longArrayOf(0, 500, 300, 500, 900)
        runCatching {
            v.vibrate(VibrationEffect.createWaveform(pattern, 0))
        }.onFailure { Log.w(TAG, "could not vibrate", it) }
    }

    private fun stopVibrate() {
        runCatching { vibrator?.cancel() }
        vibrator = null
    }

    // ----- torch -----

    private fun startTorch(context: Context) {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        torchId = runCatching {
            manager.cameraIdList.firstOrNull { id ->
                manager.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            }
        }.getOrNull()
        val id = torchId ?: return

        // ~4 Hz strobe: on for 125 ms, off for 125 ms.
        strobeRunnable = object : Runnable {
            override fun run() {
                if (!isActive) return
                torchOn = !torchOn
                try {
                    manager.setTorchMode(id, torchOn)
                } catch (e: CameraAccessException) {
                    Log.w(TAG, "torch unavailable", e)
                    return
                } catch (e: IllegalArgumentException) {
                    Log.w(TAG, "torch id rejected", e)
                    return
                }
                handler.postDelayed(this, 125L)
            }
        }.also { handler.post(it) }
    }

    private fun stopTorch(context: Context) {
        val id = torchId ?: return
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        runCatching { manager.setTorchMode(id, false) }
        torchOn = false
        torchId = null
    }

    // ----- notification -----

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Phone found alert",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Shown while VocaLock is ringing so you can stop it"
                setSound(null, null)
                enableVibration(false)
            },
        )
    }

    private fun postNotification(context: Context) {
        val stop = PendingIntent.getBroadcast(
            context,
            1,
            Intent(context, AlertActionReceiver::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            context,
            2,
            Intent(context, AlertActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle("Phone found")
            .setContentText("VocaLock is ringing")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setSilent(true)
            .setFullScreenIntent(open, true)
            .setContentIntent(open)
            .addAction(R.drawable.ic_stat_stop, "Stop", stop)
            .build()
        NotificationManagerCompatSafe.notify(context, NOTIFICATION_ID, notification)
    }
}
