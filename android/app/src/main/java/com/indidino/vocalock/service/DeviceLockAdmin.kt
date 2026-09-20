package com.indidino.vocalock.service

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device-admin registration, which exists for exactly one capability:
 * DevicePolicyManager.lockNow().
 *
 * It asks for force-lock and nothing else. No password policies, no wipe, no
 * camera control — a narrow declaration is both honest and much easier to
 * justify when Play reviews the restricted permission.
 */
class DeviceLockAdmin : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "DeviceLockAdmin"
    }

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "device admin enabled — voice lock will use the real lock screen")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        // Nothing to clean up: LockController re-checks on every lock, so this
        // simply falls back to the overlay from the next lock onwards.
        Log.i(TAG, "device admin disabled — falling back to the overlay lock")
    }

    /** Shown on the system screen when the user tries to turn admin off. */
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        context.getString(com.indidino.vocalock.R.string.vl_admin_disable_warning)
}
