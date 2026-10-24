package com.indidino.vocalock.plugins

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.razorpay.Checkout
import com.razorpay.PaymentData
import org.json.JSONObject

/**
 * Razorpay's native Android Checkout, inside the app.
 *
 * Replaces the hosted page in a Chrome Custom Tab: no browser, no address bar,
 * and UPI apps installed on the phone show as one-tap tiles. The server side is
 * unchanged — it still creates the subscription and verifies the signature this
 * returns, exactly as it did for the hosted page.
 *
 * The SDK reports back to the Activity (PaymentResultWithDataListener), so
 * MainActivity forwards both callbacks to [onSuccess] and [onError].
 */
@CapacitorPlugin(name = "RazorpayPlugin")
class RazorpayPlugin : Plugin() {

    companion object {
        /** The one checkout in flight; the SDK only ever shows one. */
        @Volatile
        private var pending: PluginCall? = null
        @Volatile
        private var instance: RazorpayPlugin? = null

        fun onSuccess(paymentId: String?, data: PaymentData?) {
            val call = pending ?: return
            pending = null
            instance?.bridge?.releaseCall(call)
            call.resolve(
                JSObject()
                    .put("paymentId", data?.paymentId ?: paymentId.orEmpty())
                    .put("subscriptionId", data?.data?.optString("razorpay_subscription_id").orEmpty())
                    .put("signature", data?.signature.orEmpty()),
            )
        }

        fun onError(code: Int, response: String?, data: PaymentData?) {
            val call = pending ?: return
            pending = null
            instance?.bridge?.releaseCall(call)
            // The SDK's description is JSON when Razorpay sent one, plain text
            // otherwise; keep whichever reads like a message.
            val message = runCatching {
                JSONObject(response.orEmpty()).optJSONObject("error")?.optString("description")
            }.getOrNull()?.takeIf { it.isNotBlank() } ?: response.orEmpty()
            call.reject(
                message.ifBlank { "Payment did not go through" },
                if (code == Checkout.PAYMENT_CANCELED) "cancelled" else "error_$code",
                JSObject()
                    .put("code", code)
                    .put("paymentId", data?.paymentId.orEmpty()),
            )
        }
    }

    override fun load() {
        instance = this
        // Fetches Checkout's assets ahead of the first tap, so it opens faster.
        runCatching { Checkout.preload(context.applicationContext) }
    }

    /**
     * Opens Checkout with the same options the hosted page used to take. The key
     * is set separately because the SDK wants it outside the options.
     */
    @PluginMethod
    fun open(call: PluginCall) {
        val options = call.getObject("options")
        val key = options?.getString("key")
        if (options == null || key.isNullOrBlank()) {
            call.reject("Payment options are missing")
            return
        }
        pending?.let { stale ->
            bridge.releaseCall(stale)
            stale.reject("Superseded by a new checkout", "cancelled")
        }
        bridge.saveCall(call)
        pending = call
        activity.runOnUiThread {
            try {
                val checkout = Checkout()
                checkout.setKeyID(key)
                options.remove("key")
                checkout.open(activity, JSONObject(options.toString()))
            } catch (e: Exception) {
                onError(-1, e.message, null)
            }
        }
    }
}
