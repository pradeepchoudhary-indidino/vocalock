package com.indidino.vocalock.ui

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
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
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Palette.alertTop, Palette.alertMid, Palette.alertBottom),
            )
        }

        // The bell sits on a white tile with the hard drop the rest of the app
        // uses, rather than floating loose on the gradient.
        val tile = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(30).toFloat()
            }
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(dp(112), dp(112))
            setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        val bell = ImageView(this).apply {
            setImageResource(R.drawable.ic_bell_large)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        tile.addView(bell)

        // The hard edge under the tile: a thin strip of the deep brand tone.
        val tileShadow = View(this).apply {
            background = GradientDrawable().apply {
                setColor(Palette.tileEdge)
                cornerRadius = dp(4).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(dp(96), dp(6)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = -dp(3)
            }
        }
        root.addView(tile)
        root.addView(tileShadow)

        root.addView(
            TextView(this).apply {
                text = getString(R.string.vl_phone_found)
                setTextColor(Color.WHITE)
                textSize = 30f
                typeface = display(700)
                gravity = Gravity.CENTER
                setPadding(0, dp(24), 0, dp(6))
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

        // A pill with the app's hard drop under it, so pressing it reads the
        // same way every other button in the app does.
        val stopWrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(36) }
        }
        val stop = TextView(this).apply {
            text = getString(R.string.vl_stop_alert)
            setTextColor(Palette.onLightBrand)
            textSize = 17f
            typeface = display(600)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(28).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(56),
            )
            setOnClickListener {
                AlertController.stop(this@AlertActivity, "button")
                finish()
            }
        }
        val stopEdge = View(this).apply {
            background = GradientDrawable().apply {
                setColor(Palette.tileEdge)
                cornerRadius = dp(3).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(5),
            ).apply {
                leftMargin = dp(10)
                rightMargin = dp(10)
                topMargin = -dp(2)
            }
        }
        stopWrap.addView(stop)
        stopWrap.addView(stopEdge)
        root.addView(stopWrap)

        countdown = TextView(this).apply {
            text = countdownText(AlertController.secondsLeft)
            setTextColor(Palette.alertSub)
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, 0)
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

    /**
     * The app's display face is a bundled web font the WebView owns, and this
     * screen runs without one. Fall back to the platform's own rounded-ish sans
     * at the matching weight rather than shipping the font twice.
     */
    private fun display(weight: Int): Typeface =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Typeface.create(Typeface.SANS_SERIF, weight, false)
        } else {
            Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
}
