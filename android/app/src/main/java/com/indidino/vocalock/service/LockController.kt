package com.indidino.vocalock.service

import android.content.Context
import android.provider.Settings
import android.util.Log
import com.indidino.vocalock.ui.LockOverlay
import org.json.JSONObject

/**
 * Owns the lock state (spec section 4.6). The flag lives in SharedPreferences,
 * not in memory, so a lock that was up survives the service being restarted.
 */
object LockController {

    private const val TAG = "LockController"

    private var overlay: LockOverlay? = null

    @Volatile
    var isLocked = false
        private set

    /** Set by ListenerService so a spoken unlock can clear the overlay. */
    @Volatile
    var onLockStateChanged: ((locked: Boolean, how: String?) -> Unit)? = null

    fun restore(context: Context) {
        if (SettingsStore.read(context).isLocked) lock(context, announce = false)
    }

    fun lock(context: Context, announce: Boolean = true) {
        val app = context.applicationContext
        if (!Settings.canDrawOverlays(app)) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW not granted; cannot show the lock")
            return
        }
        if (isLocked && overlay?.isShowing == true) return

        val view = overlay ?: LockOverlay(app).also { overlay = it }
        view.onUnlocked = { how -> clear(app, how) }
        view.show()

        isLocked = true
        SettingsStore.setLocked(app, true)
        if (announce) {
            ListenerBus.emit("lockState", JSONObject().put("locked", true))
            onLockStateChanged?.invoke(true, null)
        }
    }

    /** Spoken unlock phrase heard while the lock is up. */
    fun unlockByVoice(context: Context) {
        if (!isLocked) return
        clear(context, "voice")
        overlay?.hide()
    }

    fun unlock(context: Context) {
        if (!isLocked) return
        clear(context, "pin")
        overlay?.hide()
    }

    private fun clear(context: Context, how: String) {
        val app = context.applicationContext
        isLocked = false
        SettingsStore.setLocked(app, false)
        ListenerBus.emit("lockState", JSONObject().put("locked", false).put("how", how))
        onLockStateChanged?.invoke(false, how)
    }
}
