package com.indidino.vocalock.service

import org.json.JSONObject

/**
 * One-way channel from the service to ListenerPlugin so it can forward events to
 * React through notifyListeners. Same process, so a plain callback is enough —
 * and deliberately optional: when no WebView is attached the service just drops
 * events and keeps running (spec hard rule 1).
 */
object ListenerBus {

    @Volatile
    private var sink: ((String, JSONObject) -> Unit)? = null

    fun attach(sink: (String, JSONObject) -> Unit) {
        this.sink = sink
    }

    fun detach() {
        sink = null
    }

    fun emit(event: String, data: JSONObject = JSONObject()) {
        sink?.invoke(event, data)
    }
}
