package com.indidino.vocalock.service

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import com.indidino.vocalock.R

/**
 * Locks the phone for real, using its own lock screen.
 *
 * The difference from the overlay is not cosmetic: force-stopping VocaLock does
 * not unlock the device, because it was Android that locked it. The cost is
 * that nothing can unlock it either — no app may dismiss a secure keyguard, so
 * the user gets back in with their fingerprint or PIN and the unlock phrase has
 * no meaning in this mode.
 */
object DeviceLock {

    private const val TAG = "DeviceLock"

    private fun admin(context: Context) =
        ComponentName(context.applicationContext, DeviceLockAdmin::class.java)

    private fun policy(context: Context) =
        context.applicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE)
            as DevicePolicyManager

    /** True when the user has granted device admin, so lockNow() will work. */
    fun isActive(context: Context): Boolean = runCatching {
        policy(context).isAdminActive(admin(context))
    }.getOrDefault(false)

    /**
     * The system consent screen. Must be started from an Activity context —
     * this is a user decision and Android will not let it happen quietly.
     */
    fun consentIntent(context: Context): Intent =
        Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin(context))
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                context.getString(R.string.vl_admin_explanation),
            )
        }

    /** Where the user goes to turn it off again. */
    fun settingsIntent(): Intent = Intent(Settings.ACTION_SECURITY_SETTINGS)

    /** Locks the device. Returns false if admin was revoked in the meantime. */
    fun lockNow(context: Context): Boolean {
        if (!isActive(context)) return false
        return runCatching {
            policy(context).lockNow()
            true
        }.onFailure { Log.w(TAG, "lockNow refused", it) }.getOrDefault(false)
    }

    /** Lets the user revoke admin from inside the app before removing it. */
    fun release(context: Context) {
        runCatching { policy(context).removeActiveAdmin(admin(context)) }
    }
}
