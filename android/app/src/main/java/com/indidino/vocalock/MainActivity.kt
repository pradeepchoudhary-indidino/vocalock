package com.indidino.vocalock

import android.graphics.Color
import android.os.Bundle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity
import com.indidino.vocalock.plugins.ListenerPlugin
import com.indidino.vocalock.plugins.VoiceSetupPlugin
import com.indidino.vocalock.service.BootReceiver
import com.indidino.vocalock.service.ListenerService
import com.indidino.vocalock.service.NotificationManagerCompatSafe
import com.indidino.vocalock.service.SettingsStore

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ListenerPlugin::class.java)
        registerPlugin(VoiceSetupPlugin::class.java)
        super.onCreate(savedInstanceState)
        paintWebViewGround()
        publishInsets()
        resumeListeningIfArmed()
    }

    /**
     * Feed the real window insets to CSS as --safe-top, --safe-bottom and --kb.
     *
     * `env(safe-area-inset-*)` is the obvious way to do the first two and it
     * does not work here: since Android 15 every app targeting SDK 35+ is forced
     * edge-to-edge, `overlaysWebView: false` and StatusBar.setBackgroundColor
     * became no-ops, and the WebView reports zero for env() anyway. The result
     * was the status bar sitting on top of the screen's content.
     *
     * --kb is the keyboard's own height. The WebView is not resized when the IME
     * opens, so without it a docked button — "Send code", "Verify" — sits behind
     * the keyboard exactly when it is needed. theme.css subtracts it from the
     * screen so the dock lands above the keys.
     *
     * Registered on the WebView, so it re-runs on rotation, on a cutout change,
     * and every time the keyboard opens or closes.
     */
    private fun publishInsets() {
        val web = bridge?.webView ?: return
        ViewCompat.setOnApplyWindowInsetsListener(web) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val d = resources.displayMetrics.density
            val top = (bars.top / d).toInt()
            val bottom = (bars.bottom / d).toInt()
            // The keyboard already covers the navigation bar, so only the part
            // of it above that counts as extra.
            val keyboard = ((ime.bottom - bars.bottom).coerceAtLeast(0) / d).toInt()
            view.post {
                web.evaluateJavascript(
                    "document.documentElement.style.setProperty('--safe-top','" + top + "px');" +
                        "document.documentElement.style.setProperty('--safe-bottom','" + bottom + "px');" +
                        "document.documentElement.style.setProperty('--kb','" + keyboard + "px');",
                    null,
                )
            }
            insets
        }
        ViewCompat.requestApplyInsets(web)
    }

    /**
     * The WebView's own ground, behind the web layer's first frame.
     *
     * Always the light ground: the app defaults to the light theme because that
     * is how the design is drawn. The theme preference itself lives in the
     * WebView's localStorage, which this side cannot read, so someone who has
     * chosen dark sees this for the one frame before index.html repaints — not
     * worth a second storage mechanism to remove.
     */
    private fun paintWebViewGround() {
        bridge?.webView?.setBackgroundColor(Color.parseColor("#EEF4FC"))
    }

    /**
     * Android blocks starting a microphone foreground service from
     * BOOT_COMPLETED, so opening the app IS the documented way back — that is
     * what the "Tap to resume listening" notification promises. Done natively
     * rather than from React so it does not wait on the WebView, and so it still
     * happens if the web layer fails to load.
     */
    private fun resumeListeningIfArmed() {
        if (!SettingsStore.read(this).needsMic) return
        if (ListenerService.isRunning) return
        ListenerService.start(this)
        NotificationManagerCompatSafe.cancel(this, BootReceiver.NOTIFICATION_ID)
    }
}
