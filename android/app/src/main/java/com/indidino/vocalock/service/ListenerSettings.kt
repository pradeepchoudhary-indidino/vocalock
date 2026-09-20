package com.indidino.vocalock.service

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * The settings document the service actually runs on. The React UI writes it
 * through ListenerPlugin; SharedPreferences is the single source of truth so the
 * service keeps working with no WebView alive (spec section 3).
 */
data class ListenerSettings(
    val clapEnabled: Boolean = false,
    val sensitivity: String = "med",
    val clapsRequired: Int = 2,
    val whistleEnabled: Boolean = true,
    /**
     * On by default. Clap to Find exists to locate a phone you have lost — if
     * the screen is on you are holding it. Leaving the microphone open in that
     * state costs battery for no benefit and is what makes claps in a video set
     * the alert off.
     */
    val onlyWhenScreenOff: Boolean = true,
    val ring: Boolean = true,
    val vibrate: Boolean = true,
    val flashlight: Boolean = true,
    val ringtone: String = "default",
    val alertDurationSec: Int = 30,
    val voiceLockEnabled: Boolean = false,
    /** Which Vosk model spots the phrases: "en" or "hi". */
    val language: String = "en",
    val lockPhrase: String = "",
    val unlockPhrase: String = "",
    val isLocked: Boolean = false,
) {
    /** True when any detector needs the microphone open. */
    val needsMic: Boolean get() = clapEnabled || voiceLockEnabled

    /** Energy multiplier over the noise floor a clap has to clear. */
    val clapThresholdFactor: Float
        get() = when (sensitivity) {
            "low" -> 8f
            "high" -> 3f
            else -> 5f
        }
}

object SettingsStore {

    const val PREFS_NAME = "vocalock_settings"

    private const val CLAP_ENABLED = "clapEnabled"
    private const val SENSITIVITY = "sensitivity"
    private const val CLAPS_REQUIRED = "clapsRequired"
    private const val WHISTLE_ENABLED = "whistleEnabled"
    private const val ONLY_WHEN_SCREEN_OFF = "onlyWhenScreenOff"
    private const val RING = "ring"
    private const val VIBRATE = "vibrate"
    private const val FLASHLIGHT = "flashlight"
    private const val RINGTONE = "ringtone"
    private const val ALERT_DURATION_SEC = "alertDurationSec"
    private const val VOICE_LOCK_ENABLED = "voiceLockEnabled"
    private const val LANGUAGE = "language"
    private const val LOCK_PHRASE = "lockPhrase"
    private const val UNLOCK_PHRASE = "unlockPhrase"
    private const val IS_LOCKED = "isLocked"

    fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun read(context: Context): ListenerSettings {
        val p = prefs(context)
        val d = ListenerSettings()
        return ListenerSettings(
            clapEnabled = p.getBoolean(CLAP_ENABLED, d.clapEnabled),
            sensitivity = p.getString(SENSITIVITY, d.sensitivity) ?: d.sensitivity,
            clapsRequired = p.getInt(CLAPS_REQUIRED, d.clapsRequired).coerceIn(1, 5),
            whistleEnabled = p.getBoolean(WHISTLE_ENABLED, d.whistleEnabled),
            onlyWhenScreenOff = p.getBoolean(ONLY_WHEN_SCREEN_OFF, d.onlyWhenScreenOff),
            ring = p.getBoolean(RING, d.ring),
            vibrate = p.getBoolean(VIBRATE, d.vibrate),
            flashlight = p.getBoolean(FLASHLIGHT, d.flashlight),
            ringtone = p.getString(RINGTONE, d.ringtone) ?: d.ringtone,
            alertDurationSec = p.getInt(ALERT_DURATION_SEC, d.alertDurationSec).coerceIn(10, 120),
            voiceLockEnabled = p.getBoolean(VOICE_LOCK_ENABLED, d.voiceLockEnabled),
            language = p.getString(LANGUAGE, d.language) ?: d.language,
            lockPhrase = p.getString(LOCK_PHRASE, d.lockPhrase) ?: d.lockPhrase,
            unlockPhrase = p.getString(UNLOCK_PHRASE, d.unlockPhrase) ?: d.unlockPhrase,
            isLocked = p.getBoolean(IS_LOCKED, d.isLocked),
        )
    }

    /** Applies only the keys present in [patch], leaving the rest untouched. */
    fun write(context: Context, patch: JSONObject) {
        val e = prefs(context).edit()
        patch.keys().forEach { key ->
            if (patch.isNull(key)) return@forEach
            when (key) {
                CLAP_ENABLED, WHISTLE_ENABLED, ONLY_WHEN_SCREEN_OFF, RING, VIBRATE,
                FLASHLIGHT, VOICE_LOCK_ENABLED, IS_LOCKED ->
                    e.putBoolean(key, patch.optBoolean(key))

                CLAPS_REQUIRED -> e.putInt(key, patch.optInt(key, 2).coerceIn(1, 5))
                ALERT_DURATION_SEC -> e.putInt(key, patch.optInt(key, 30).coerceIn(10, 120))

                SENSITIVITY -> {
                    val value = patch.optString(key)
                    if (value in setOf("low", "med", "high")) e.putString(key, value)
                }

                LANGUAGE -> {
                    val value = patch.optString(key)
                    if (value in setOf("en", "hi")) e.putString(key, value)
                }

                RINGTONE, LOCK_PHRASE, UNLOCK_PHRASE -> e.putString(key, patch.optString(key))
            }
        }
        e.apply()
    }

    fun setLocked(context: Context, locked: Boolean) {
        prefs(context).edit().putBoolean(IS_LOCKED, locked).apply()
    }

    fun toJson(s: ListenerSettings): JSONObject = JSONObject().apply {
        put(CLAP_ENABLED, s.clapEnabled)
        put(SENSITIVITY, s.sensitivity)
        put(CLAPS_REQUIRED, s.clapsRequired)
        put(WHISTLE_ENABLED, s.whistleEnabled)
        put(ONLY_WHEN_SCREEN_OFF, s.onlyWhenScreenOff)
        put(RING, s.ring)
        put(VIBRATE, s.vibrate)
        put(FLASHLIGHT, s.flashlight)
        put(RINGTONE, s.ringtone)
        put(ALERT_DURATION_SEC, s.alertDurationSec)
        put(VOICE_LOCK_ENABLED, s.voiceLockEnabled)
        put(LANGUAGE, s.language)
        put(LOCK_PHRASE, s.lockPhrase)
        put(UNLOCK_PHRASE, s.unlockPhrase)
        put(IS_LOCKED, s.isLocked)
    }
}
