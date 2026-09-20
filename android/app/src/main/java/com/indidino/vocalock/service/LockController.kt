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
        if (isLocked && overlay?.isShowing == true) return

        // The overlay is the default because it is silent. Lock Task Mode
        // blocks the shade, Home and Recents, but Android insists on its own
        // confirmation every time it starts, so it is opt-in — and the overlay
        // also covers the case where the Activity cannot be launched.
        // Two modes, and the choice is simply whether device admin was granted.
        //
        // Screen pinning used to sit in between. It blocked the shade, but
        // without Device Owner Android demands confirmation every single time
        // lock task starts, and a system prompt before every lock is worse than
        // the problem it solves. The phone's own lock screen achieves the same
        // thing with no prompt at all.
        if (DeviceLock.lockNow(app)) {
            // Android holds the lock now, not us: there is no overlay to
            // dismiss later and no lock state of ours to track. The user gets
            // back in with their own credential.
            if (announce) ListenerBus.emit("lockState", JSONObject().put("locked", true))
            return
        }

        if (Settings.canDrawOverlays(app)) {
            val view = overlay ?: LockOverlay(app).also { overlay = it }
            view.onUnlocked = { how -> clear(app, how) }
            view.show()
        } else {
            Log.w(TAG, "no device admin and no overlay permission; cannot lock")
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
