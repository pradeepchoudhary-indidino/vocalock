package com.indidino.vocalock.service

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Product events that happen in native code — alerts, locks, unlocks, service
 * restarts — usually with the app closed, so there is no WebView to send them.
 *
 * They wait here, in their own SharedPreferences file, until the app next opens
 * and its analytics queue drains them (ListenerPlugin.drainNativeEvents) and
 * sends them with everything else. Capped, so a phone that never reopens the
 * app does not grow the file forever.
 */
object NativeEvents {

    private const val PREFS = "vocalock_native_events"
    private const val KEY = "pending"
    private const val CAP = 300

    private val lock = Any()

    fun record(context: Context, event: String, props: JSONObject = JSONObject()) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(lock) {
            val pending = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrElse { JSONArray() }
            pending.put(
                JSONObject()
                    .put("event", event)
                    .put("ts", System.currentTimeMillis())
                    .put("props", props),
            )
            // Keep the newest when full: recent behaviour matters more.
            val kept = if (pending.length() > CAP) {
                JSONArray().also { trimmed ->
                    for (i in pending.length() - CAP until pending.length()) trimmed.put(pending.get(i))
                }
            } else {
                pending
            }
            prefs.edit().putString(KEY, kept.toString()).apply()
        }
    }

    /** Returns everything recorded so far and forgets it. */
    fun drain(context: Context): JSONArray {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(lock) {
            val pending = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrElse { JSONArray() }
            prefs.edit().remove(KEY).apply()
            return pending
        }
    }
}
