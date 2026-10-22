package com.indidino.vocalock.plugins

import android.os.Build
import android.os.Bundle
import android.util.Log
import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsConstants
import com.facebook.appevents.AppEventsLogger
import com.facebook.internal.AttributionIdentifiers
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.indidino.vocalock.R
import org.json.JSONObject
import java.math.BigDecimal
import java.util.Currency

/**
 * Meta App Events, for ads attribution.
 *
 * Installs and app opens are logged by the SDK on its own. This bridge adds the
 * funnel events Meta's campaigns optimise for, and hands the server the ids it
 * needs to report renewals — which happen while the app is closed — through the
 * Conversions API.
 *
 * Every call is a no-op until the App ID and client token are configured (see
 * gradle.properties); the SDK itself is not initialised until then either.
 */
@CapacitorPlugin(name = "Meta")
class MetaPlugin : Plugin() {

    // Also requires the SDK to have started: in 1.0-1.3 it never did, and
    // creating a logger then threw and took the whole app down.
    private val enabled: Boolean
        get() = context.resources.getBoolean(R.bool.meta_enabled) && FacebookSdk.isInitialized()

    private val logger by lazy { AppEventsLogger.newLogger(context) }

    /**
     * event: "registration" | "trial" | "subscribe".
     * value + currency for the paid ones; method for registration.
     */
    @PluginMethod
    fun logEvent(call: PluginCall) {
        if (!enabled) return call.resolve()
        val event = call.getString("event")
        if (event !in setOf("registration", "trial", "subscribe")) return call.reject("Unknown event")
        val value = call.getDouble("value")
        val currency = call.getString("currency") ?: "INR"
        // Analytics must never crash the app: a lost event is the worst case.
        try {
            when (event) {
                "registration" -> logger.logEvent(
                    AppEventsConstants.EVENT_NAME_COMPLETED_REGISTRATION,
                    Bundle().apply {
                        putString(AppEventsConstants.EVENT_PARAM_REGISTRATION_METHOD, call.getString("method") ?: "google")
                    },
                )
                "trial" -> logger.logEvent(
                    AppEventsConstants.EVENT_NAME_START_TRIAL,
                    value ?: 0.0,
                    Bundle().apply { putString(AppEventsConstants.EVENT_PARAM_CURRENCY, currency) },
                )
                // A paid first period is both a subscription and revenue, so it is
                // also logged as a purchase: that is what value optimisation reads.
                "subscribe" -> {
                    logger.logEvent(
                        AppEventsConstants.EVENT_NAME_SUBSCRIBE,
                        value ?: 0.0,
                        Bundle().apply { putString(AppEventsConstants.EVENT_PARAM_CURRENCY, currency) },
                    )
                    if (value != null) logger.logPurchase(BigDecimal.valueOf(value), Currency.getInstance(currency))
                }
            }
        } catch (e: Exception) {
            Log.w("MetaPlugin", "logEvent failed", e)
        }
        call.resolve()
    }

    /**
     * The install id and advertising id the server stamps on Conversions API
     * events, so a renewal is credited to the ad that brought the install.
     * Reading the advertising id talks to Play services, so it is off the
     * main thread.
     */
    @PluginMethod
    fun getAttribution(call: PluginCall) {
        if (!enabled) return call.resolve(JSObject())
        Thread {
            try {
                val ids = AttributionIdentifiers.getAttributionIdentifiers(context)
                call.resolve(
                    JSObject()
                        .put("anonId", AppEventsLogger.getAnonymousAppDeviceGUID(context))
                        .put("advertiserId", ids?.androidAdvertiserId ?: JSONObject.NULL)
                        .put("trackingLimited", ids?.isTrackingLimited ?: true)
                        // Meta rejects a server event whose device info lacks these.
                        .put("osVersion", Build.VERSION.RELEASE)
                        .put("deviceModel", Build.MODEL)
                        .put("appVersion", context.packageManager.getPackageInfo(context.packageName, 0).versionName),
                )
            } catch (e: Exception) {
                Log.w("MetaPlugin", "getAttribution failed", e)
                call.resolve(JSObject())
            }
        }.start()
    }
}
