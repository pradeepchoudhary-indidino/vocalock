package com.indidino.vocalock.plugins

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.indidino.vocalock.service.ListenerService

/**
 * Phrase capture during setup (spec section 4.1).
 *
 * Android's SpeechRecognizer, not the browser's Web Speech API — that one is
 * unreliable inside the Android WebView. This runs only while the user is on a
 * setup step; the always-on listening path is Vosk inside ListenerService.
 */
@CapacitorPlugin(name = "VoiceSetupPlugin")
class VoiceSetupPlugin : Plugin() {

    private var recognizer: SpeechRecognizer? = null

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(
            JSObject().put("available", SpeechRecognizer.isRecognitionAvailable(context)),
        )
    }

    @PluginMethod
    fun startCapture(call: PluginCall) {
        val language = call.getString("language") ?: "en-IN"
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            call.reject("Speech recognition is not available on this phone")
            return
        }

        // Resolve straight away and do the work off the main thread. Capacitor
        // runs plugin methods on the main thread, and the microphone handover
        // below waits for our own capture loop to let go — blocking here would
        // freeze the UI and risk an ANR. Failures reach the UI as a
        // captureError event, which the capture screen already renders.
        call.resolve()

        Thread({
            if (!ListenerService.yieldMic()) {
                ListenerService.reclaimMic()
                emitErrorMessage("Could not free the microphone. Try again in a moment.")
                return@Thread
            }
            activity.runOnUiThread { beginListening(language) }
        }, "vocalock-voice-setup").start()
    }

    /**
     * Our always-on AudioRecord would otherwise keep the microphone and
     * SpeechRecognizer would hear pure silence — it reports NO_SPEECH_DETECTED
     * however loudly the user speaks. Only call this once the mic is yielded.
     */
    private fun beginListening(language: String) {
        releaseRecognizer()
        val speech = SpeechRecognizer.createSpeechRecognizer(context)
        speech.setRecognitionListener(listener)
        recognizer = speech

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // Keep it on-device where the phone supports it, so setup audio is
            // treated the same way as everything else in the app.
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
        runCatching { speech.startListening(intent) }
            .onFailure {
                finishCapture()
                emitErrorMessage(it.message ?: "Could not start listening")
            }
    }

    @PluginMethod
    fun stopCapture(call: PluginCall) {
        activity.runOnUiThread { runCatching { recognizer?.stopListening() } }
        finishCapture()
        call.resolve()
    }

    override fun handleOnDestroy() {
        activity.runOnUiThread { releaseRecognizer() }
        finishCapture()
        super.handleOnDestroy()
    }

    /** Hand the microphone back to the listener. Safe to call more than once. */
    private fun finishCapture() {
        ListenerService.reclaimMic()
    }

    private fun releaseRecognizer() {
        runCatching { recognizer?.destroy() }
        recognizer = null
    }

    private val listener = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            firstResult(partialResults)?.let {
                notifyListeners("partialTranscript", JSObject().put("text", it))
            }
        }

        override fun onResults(results: Bundle?) {
            finishCapture()
            val text = firstResult(results)
            if (text.isNullOrBlank()) {
                emitError(SpeechRecognizer.ERROR_NO_MATCH)
            } else {
                notifyListeners("finalTranscript", JSObject().put("text", text))
            }
        }

        override fun onError(error: Int) {
            finishCapture()
            emitError(error)
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        private fun firstResult(bundle: Bundle?): String? =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
    }

    private fun emitErrorMessage(message: String, code: Int = -1) {
        notifyListeners(
            "captureError",
            JSObject().put("message", message).put("code", code),
        )
    }

    private fun emitError(code: Int) {
        // SpeechRecognizer's codes are meaningless to a user; say what to do.
        val message = when (code) {
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            -> "Did not catch that. Try again, a little louder."

            SpeechRecognizer.ERROR_AUDIO -> "Could not read the microphone."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                "Microphone permission is needed to record your phrase."

            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            -> "Speech recognition needs a connection on this phone."

            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Still finishing the last one. Try again."
            SpeechRecognizer.ERROR_CLIENT -> "Recognition stopped. Try again."
            else -> "Could not record that. Try again."
        }
        emitErrorMessage(message, code)
    }
}
