package com.indidino.vocalock.plugins

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.indidino.vocalock.service.AlertController
import com.indidino.vocalock.service.ListenerBus
import com.indidino.vocalock.service.LockController
import com.indidino.vocalock.service.ListenerService
import com.indidino.vocalock.service.SecureStore
import com.indidino.vocalock.service.SettingsStore
import org.json.JSONObject

/**
 * The bridge described in spec section 4.1. It only reads and writes
 * SharedPreferences and sends intents — no detection logic lives here, so
 * everything keeps working once the WebView is gone.
 */
@CapacitorPlugin(
    name = "ListenerPlugin",
    permissions = [
        Permission(alias = ListenerPlugin.ALIAS_MIC, strings = [Manifest.permission.RECORD_AUDIO]),
        Permission(
            alias = ListenerPlugin.ALIAS_NOTIFICATIONS,
            strings = ["android.permission.POST_NOTIFICATIONS"],
        ),
    ],
)
class ListenerPlugin : Plugin() {

    companion object {
        const val ALIAS_MIC = "mic"
        const val ALIAS_NOTIFICATIONS = "notifications"
    }

    override fun load() {
        ListenerBus.attach { event, data -> notifyListeners(event, JSObject.fromJSONObject(data)) }
    }

    override fun handleOnDestroy() {
        ListenerBus.detach()
        super.handleOnDestroy()
    }

    // ----- service lifecycle -----

    @PluginMethod
    fun start(call: PluginCall) {
        ListenerService.start(context)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        ListenerService.stop(context)
        call.resolve()
    }

    @PluginMethod
    fun isRunning(call: PluginCall) {
        call.resolve(JSObject().put("running", ListenerService.isRunning))
    }

    // ----- settings -----

    @PluginMethod
    fun setSettings(call: PluginCall) {
        val patch = JSONObject(call.data.toString())
        // Capacitor adds its own bookkeeping key; SettingsStore ignores unknown
        // keys anyway, but drop it so nothing odd lands in prefs.
        patch.remove("callbackId")
        SettingsStore.write(context, patch)

        // Keep the service in step with what was just written.
        val settings = SettingsStore.read(context)
        if (settings.needsMic && !ListenerService.isRunning) ListenerService.start(context)
        if (!settings.needsMic && ListenerService.isRunning) ListenerService.stop(context)

        call.resolve()
    }

    @PluginMethod
    fun getSettings(call: PluginCall) {
        val settings = SettingsStore.read(context)
        call.resolve(JSObject.fromJSONObject(SettingsStore.toJson(settings)))
    }

    // ----- alert -----

    @PluginMethod
    fun testAlert(call: PluginCall) {
        AlertController.start(context, "test")
        call.resolve()
    }

    @PluginMethod
    fun stopAlert(call: PluginCall) {
        AlertController.stop(context, "button")
        call.resolve()
    }

    // ----- calibration -----

    @PluginMethod
    fun startCalibration(call: PluginCall) {
        if (getPermissionState(ALIAS_MIC).toString() != "granted") {
            call.reject("Microphone permission is needed to calibrate")
            return
        }
        ListenerService.startCalibration(context)
        call.resolve()
    }

    @PluginMethod
    fun stopCalibration(call: PluginCall) {
        ListenerService.stopCalibration(context)
        call.resolve()
    }

    // ----- setup phrase check -----

    @PluginMethod
    fun startPhraseCheck(call: PluginCall) {
        val phrase = call.getString("phrase")
        if (phrase.isNullOrBlank()) {
            call.reject("A phrase is required")
            return
        }
        if (getPermissionState(ALIAS_MIC).toString() != "granted") {
            call.reject("Microphone permission is needed to check the phrase")
            return
        }
        ListenerService.startPhraseCheck(context, phrase, call.getString("language") ?: "en")
        call.resolve()
    }

    @PluginMethod
    fun stopPhraseCheck(call: PluginCall) {
        ListenerService.stopPhraseCheck(context)
        call.resolve()
    }

    // ----- permissions -----

    @PluginMethod
    fun getPermissionStatus(call: PluginCall) {
        call.resolve(permissionStatus())
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        when (call.getString("name")) {
            ALIAS_MIC -> requestPermissionForAlias(ALIAS_MIC, call, "permissionResult")

            ALIAS_NOTIFICATIONS -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    requestPermissionForAlias(ALIAS_NOTIFICATIONS, call, "permissionResult")
                } else {
                    // Before Android 13 there is no runtime prompt; the only way
                    // to turn notifications back on is the settings screen.
                    openAppNotificationSettings()
                    call.resolve(permissionStatus())
                }
            }

            "batteryExempt" -> {
                openBatterySettingsInternal()
                call.resolve(permissionStatus())
            }

            "overlay" -> {
                openOverlaySettingsInternal()
                call.resolve(permissionStatus())
            }

            else -> call.reject("Unknown permission name")
        }
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        call.resolve(permissionStatus())
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        openBatterySettingsInternal()
        call.resolve()
    }

    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        openOverlaySettingsInternal()
        call.resolve()
    }

    // ----- PIN -----

    @PluginMethod
    fun setPin(call: PluginCall) {
        val pin = call.getString("pin")
        if (pin == null || pin.length < 4 || pin.length > 6 || !pin.all { it.isDigit() }) {
            call.reject("PIN must be 4 to 6 digits")
            return
        }
        SecureStore.setPin(context, pin)
        call.resolve()
    }

    @PluginMethod
    fun hasPin(call: PluginCall) {
        call.resolve(JSObject().put("hasPin", SecureStore.hasPin(context)))
    }

    @PluginMethod
    fun clearPin(call: PluginCall) {
        SecureStore.clearPin(context)
        call.resolve()
    }

    // ----- lock -----

    @PluginMethod
    fun lock(call: PluginCall) {
        if (!Settings.canDrawOverlays(context)) {
            call.reject("Draw over apps permission is needed to show the lock")
            return
        }
        // The service owns the mic; without it there is no way to hear the
        // unlock phrase, so make sure it is up before covering the screen.
        ListenerService.start(context)
        LockController.lock(context)
        call.resolve()
    }

    @PluginMethod
    fun unlock(call: PluginCall) {
        LockController.unlock(context)
        call.resolve()
    }

    @PluginMethod
    fun isLocked(call: PluginCall) {
        call.resolve(JSObject().put("locked", LockController.isLocked))
    }

    // ----- helpers -----

    private fun permissionStatus(): JSObject {
        val power = context.getSystemService(PowerManager::class.java)
        return JSObject()
            .put("mic", getPermissionState(ALIAS_MIC).toString() == "granted")
            .put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
            .put("batteryExempt", power?.isIgnoringBatteryOptimizations(context.packageName) == true)
            .put("overlay", Settings.canDrawOverlays(context))
    }

    /**
     * Uses the one-tap request dialog, falling back to the full battery list.
     * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is a restricted permission — see the
     * Play declaration in the compliance checklist (spec section 8).
     */
    private fun openBatterySettingsInternal() {
        val direct = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}"),
        )
        if (!launch(direct)) {
            launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun openOverlaySettingsInternal() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        )
        if (!launch(intent)) launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
    }

    private fun openAppNotificationSettings() {
        launch(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )
    }

    private fun launch(intent: Intent): Boolean {
        val target = activity ?: return false
        return runCatching { target.startActivity(intent) }.isSuccess
    }
}
