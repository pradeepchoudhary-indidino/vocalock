package com.indidino.vocalock

import android.os.Bundle
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
        resumeListeningIfArmed()
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
