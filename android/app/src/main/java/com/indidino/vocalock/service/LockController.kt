package com.indidino.vocalock.service

import android.content.Context
import android.provider.Settings
import android.util.Log
import com.indidino.vocalock.ui.LockActivity
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
        if (isLocked && (LockActivity.isShowing || overlay?.isShowing == true)) return

        // The overlay is the default because it is silent. Lock Task Mode
        // blocks the shade, Home and Recents, but Android insists on its own
        // confirmation every time it starts, so it is opt-in — and the overlay
        // also covers the case where the Activity cannot be launched.
        // The real lock screen when the user has granted device admin. This is
        // the only mode that survives the app being force-stopped, because it
        // is Android holding the lock rather than us drawing over the screen.
        if (DeviceLock.lockNow(app)) {
            isLocked = false
            SettingsStore.setLocked(app, false)
            // Nothing to dismiss later: the user gets back in with their own
            // credential, so there is no lock state for us to track.
            if (announce) ListenerBus.emit("lockState", JSONObject().put("locked", true))
            return
        }

        val blockShade = SettingsStore.read(app).blockNotificationShade
        if (blockShade && canStartActivity(app)) {
            LockActivity.show(app)
        } else if (Settings.canDrawOverlays(app)) {
            Log.w(TAG, "falling back to the overlay lock")
            val view = overlay ?: LockOverlay(app).also { overlay = it }
            view.onUnlocked = { how -> clear(app, how) }
            view.show()
        } else {
            Log.w(TAG, "neither an activity nor an overlay can be shown; not locking")
            return
        }

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
        dismissUi()
    }

    fun unlock(context: Context) {
        if (!isLocked) return
        clear(context, "pin")
        dismissUi()
    }

    private fun dismissUi() {
        LockActivity.dismiss()
        overlay?.hide()
    }

    /**
     * Starting an Activity from the background is allowed because the app holds
     * SYSTEM_ALERT_WINDOW — the same grant the overlay needs. Without it Android
     * silently drops the launch, so check rather than discover it at runtime.
     */
    private fun canStartActivity(context: Context): Boolean =
        Settings.canDrawOverlays(context)

    private fun clear(context: Context, how: String) {
        val app = context.applicationContext
        isLocked = false
        SettingsStore.setLocked(app, false)
        ListenerBus.emit("lockState", JSONObject().put("locked", false).put("how", how))
        onLockStateChanged?.invoke(false, how)
    }
}
