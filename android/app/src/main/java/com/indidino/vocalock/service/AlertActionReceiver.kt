package com.indidino.vocalock.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Backs the STOP action on the alert notification. */
class AlertActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == AlertController.ACTION_STOP) {
            AlertController.stop(context, "notification")
        }
    }
}
