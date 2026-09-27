package com.indidino.vocalock.ui

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import com.indidino.vocalock.R
import com.indidino.vocalock.service.AlertController

/**
 * Screen 12, "Phone found". Pure Kotlin on purpose: it has to appear over the
 * lock screen with no WebView alive, so it cannot be a React route. The look is
 * matched to the React theme by hand (spec section 3).
 */
class AlertActivity : AppCompatActivity() {

    companion object {
        private var live: AlertActivity? = null

        /** Called once a second by AlertController to move the countdown. */
        fun onTick(secondsLeft: Int) {
            live?.let { activity ->
                activity.runOnUiThread { activity.countdown.text = countdownText(secondsLeft) }
            }
        }

        fun onStopped() {
            live?.let { activity -> activity.runOnUiThread { activity.finish() } }
        }

        private fun countdownText(secondsLeft: Int) =
            if (secondsLeft > 0) "Stops on its own in ${secondsLeft}s" else "Stopping…"
    }

    private lateinit var countdown: TextView
    private var bellAnimator: ObjectAnimator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.VocaLockFullScreen)
        showOverLockScreen()
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(buildView())
        live = this
    }

    override fun onDestroy() {
        if (live === this) live = null
        bellAnimator?.cancel()
        super.onDestroy()
    }

    /** The back button must not dismiss a ringing alert by accident. */
    @Deprecated("Kept for API < 33; the Stop button is the way out.")
    override fun onBackPressed() {
        // Intentionally ignored.
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun buildView(): View {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(36))
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Palette.alertTop, Palette.alertMid, Palette.alertBottom),
            )
        }

        val bell = ImageView(this).apply {
            setImageResource(R.drawable.ic_bell_large)
            layoutParams = LinearLayout.LayoutParams(dp(96), dp(96))
        }
        root.addView(bell)

        root.addView(
            TextView(this).apply {
                text = getString(R.string.vl_phone_found)
                setTextColor(Color.WHITE)
                textSize = 30f
                gravity = Gravity.CENTER
                setPadding(0, dp(20), 0, dp(6))
            },
        )

        root.addView(
            TextView(this).apply {
                text = getString(R.string.vl_phone_found_sub)
                setTextColor(Palette.alertSub)
                textSize = 14f
                gravity = Gravity.CENTER
            },
        )

        val stop = TextView(this).apply {
            text = getString(R.string.vl_stop_alert)
            setTextColor(Palette.onLightBrand)
            textSize = 16f
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(27).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(54),
            ).apply { topMargin = dp(34) }
            setOnClickListener {
                AlertController.stop(this@AlertActivity, "button")
                finish()
            }
        }
        root.addView(stop)

        countdown = TextView(this).apply {
            text = countdownText(AlertController.secondsLeft)
            setTextColor(Palette.alertSub)
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
        }
        root.addView(countdown)

        bellAnimator = ObjectAnimator.ofFloat(bell, View.ROTATION, -12f, 12f).apply {
            duration = 260
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            start()
        }

        return root
    }
}
