package com.indidino.vocalock.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import com.indidino.vocalock.MainActivity
import com.indidino.vocalock.R

/**
 * Spec section 4.2.
 *
 * Android 14+ refuses to let a microphone foreground service start from
 * BOOT_COMPLETED, so we do not try. Instead we post a notification that opens
 * the app, and opening the app starts the service — which is a documented,
 * allowed path. The Clap to Find screen tells the user this will happen.
 */
class BootReceiver : BroadcastReceiver() {

    private val TAG = "BootReceiver"


    companion object {
        const val CHANNEL_ID = "vocalock_boot"
        const val NOTIFICATION_ID = 4103

        /**
         * A real boot means the device has only just come up. Android delivers
         * BOOT_COMPLETED outside an actual boot as well — being force-stopped
         * and relaunched triggers it — and acting on those was posting "tap to
         * resume listening" to people who had not restarted anything, and
         * silently clearing an active lock.
         *
         * elapsedRealtime() is time since boot, so anything beyond this is not
         * a boot however the broadcast is labelled.
         */
        private const val BOOT_GRACE_MS = 3 * 60 * 1000L
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }

        if (SystemClock.elapsedRealtime() > BOOT_GRACE_MS) {
            Log.i(TAG, "ignoring BOOT_COMPLETED: device has been up too long to be a boot")
            return
        }

        val settings = SettingsStore.read(context)
        if (!settings.needsMic) return

        // A lock that was showing when the phone went down must not survive a
        // reboot as an un-dismissable overlay with no service behind it.
        if (settings.isLocked) SettingsStore.setLocked(context, false)

        ensureChannel(context)

        val open = PendingIntent.getActivity(
            context,
            3,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setContentTitle(context.getString(R.string.vl_boot_title))
            .setContentText(context.getString(R.string.vl_boot_text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()

        NotificationManagerCompatSafe.notify(context, NOTIFICATION_ID, notification)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.vl_boot_channel),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "Reminds you to reopen VocaLock after a restart" },
        )
    }
}
