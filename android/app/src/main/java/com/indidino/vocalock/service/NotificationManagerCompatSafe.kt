package com.indidino.vocalock.service

import android.app.Notification
import android.content.Context
import android.util.Log
import androidx.core.app.NotificationManagerCompat

/**
 * Notifications are optional for us — the alert still rings without them — so a
 * missing POST_NOTIFICATIONS grant must never take the process down.
 */
object NotificationManagerCompatSafe {

    fun notify(context: Context, id: Int, notification: Notification) {
        runCatching {
            NotificationManagerCompat.from(context).notify(id, notification)
        }.onFailure { Log.w("VocaLock", "notify($id) refused", it) }
    }

    fun cancel(context: Context, id: Int) {
        runCatching { NotificationManagerCompat.from(context).cancel(id) }
    }
}
