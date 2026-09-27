package com.indidino.vocalock.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.indidino.vocalock.R
import com.indidino.vocalock.service.SecureStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The lock screen itself (spec section 4.6). A TYPE_APPLICATION_OVERLAY window,
 * not an Activity, so it stays up over whatever the user switches to.
 *
 * Deliberately NOT an Accessibility Service: that would be the only way to also
 * block the nav bar, and Play policy forbids using accessibility for this.
 */
class LockOverlay(private val context: Context) {

    companion object {
        private const val TAG = "LockOverlay"
        private const val MAX_ATTEMPTS = 5
        private const val LOCKOUT_MS = 30_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val windowManager =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private var root: LinearLayout? = null
    private var clockView: TextView? = null
    private var statusView: TextView? = null
    private var pinPad: View? = null
    private var dotsRow: LinearLayout? = null

    private var pin = StringBuilder()
    private var wrongAttempts = 0
    private var lockedOutUntil = 0L

    /** Called when the user gets in with the PIN. */
    var onUnlocked: ((how: String) -> Unit)? = null

    val isShowing: Boolean get() = root != null

    private val clockTick = object : Runnable {
        override fun run() {
            clockView?.text = SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())
            handler.postDelayed(this, 10_000L)
        }
    }

    fun show() {
        if (root != null) return
        handler.post {
            try {
                val view = buildView()
                windowManager.addView(view, layoutParams())
                hideSystemBars(view)
                // The bars come back on any swipe; re-hide whenever that happens.
                view.setOnApplyWindowInsetsListener { v, insets ->
                    hideSystemBars(v)
                    insets
                }
                root = view
                handler.post(clockTick)
            } catch (e: Exception) {
                // Almost always a missing SYSTEM_ALERT_WINDOW grant.
                Log.e(TAG, "could not add lock overlay", e)
            }
        }
    }

    fun hide() {
        handler.post {
            handler.removeCallbacks(clockTick)
            root?.let { view ->
                runCatching { windowManager.removeView(view) }
            }
            root = null
            pin.setLength(0)
            wrongAttempts = 0
        }
    }

    /** Spoken unlock succeeded; close up. */
    fun dismissByVoice() {
        onUnlocked?.invoke("voice")
        hide()
    }

    private fun layoutParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        }
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                // Without these two the window is laid out inside the system
                // insets, so the status bar stays visible above the lock.
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            android.graphics.PixelFormat.OPAQUE,
        ).apply {
            gravity = Gravity.CENTER
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // Draw into the notch/cutout area too, so there is no strip of
                // the screen underneath the lock.
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
        }
    }

    /**
     * Hides the status and navigation bars while the lock is up.
     *
     * This is cosmetic, not a barrier: Android gives no app the ability to block
     * the notification shade, and a swipe still brings the bars back. Anything
     * that did block it would mean an Accessibility Service, which Play policy
     * forbids for this purpose.
     */
    private fun hideSystemBars(view: View) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            view.windowInsetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            view.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    @SuppressLint("SetTextI18n")
    private fun buildView(): LinearLayout {
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(40), dp(28), dp(40))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Palette.lockFrom, Palette.lockTo),
            )
            // Swallow every touch so nothing underneath reacts.
            isClickable = true
            isFocusable = true
        }

        clockView = TextView(context).apply {
            text = SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())
            setTextColor(Color.WHITE)
            textSize = 52f
            gravity = Gravity.CENTER
        }
        root.addView(clockView)

        root.addView(
            TextView(context).apply {
                text = context.getString(R.string.vl_locked_by)
                setTextColor(Palette.lockInkFaint)
                textSize = 13f
                gravity = Gravity.CENTER
                setPadding(0, dp(6), 0, dp(34))
            },
        )

        statusView = TextView(context).apply {
            text = context.getString(R.string.vl_say_unlock)
            setTextColor(Palette.lockInkSoft)
            textSize = 15f
            gravity = Gravity.CENTER
        }
        root.addView(statusView)

        // A quiet, always-on indication that the mic is live, so the user is
        // never listened to without a visible sign of it.
        root.addView(
            TextView(context).apply {
                text = context.getString(R.string.vl_mic_live)
                setTextColor(Palette.accent)
                textSize = 12f
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, dp(26))
            },
        )

        dotsRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            visibility = View.GONE
        }
        root.addView(dotsRow)

        pinPad = buildPinPad(::dp).apply { visibility = View.GONE }
        root.addView(pinPad)

        val usePin = TextView(context).apply {
            text = context.getString(R.string.vl_use_pin)
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(14), dp(28), dp(14))
            background = GradientDrawable().apply {
                setColor(Palette.lockSurface)
                cornerRadius = dp(24).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(10) }
            setOnClickListener {
                visibility = View.GONE
                dotsRow?.visibility = View.VISIBLE
                pinPad?.visibility = View.VISIBLE
                refreshDots()
            }
        }
        root.addView(usePin)

        return root
    }

    private fun buildPinPad(dp: (Int) -> Int): View {
        val grid = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        val rows = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("", "0", "⌫"),
        )
        rows.forEach { row ->
            val line = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            row.forEach { key ->
                line.addView(buildKey(key, dp))
            }
            grid.addView(line)
        }
        return grid
    }

    private fun buildKey(key: String, dp: (Int) -> Int): View {
        val view = TextView(context).apply {
            text = key
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(72), dp(62)).apply {
                setMargins(dp(6), dp(6), dp(6), dp(6))
            }
            if (key.isNotEmpty()) {
                background = GradientDrawable().apply {
                    setColor(Palette.lockSurface)
                    cornerRadius = dp(20).toFloat()
                }
            }
        }
        if (key.isEmpty()) return view

        view.setOnClickListener {
            if (System.currentTimeMillis() < lockedOutUntil) return@setOnClickListener
            if (key == "⌫") {
                if (pin.isNotEmpty()) pin.setLength(pin.length - 1)
            } else if (pin.length < 6) {
                pin.append(key)
            }
            refreshDots()
            val expected = SecureStore.pinLength(context)
            if (expected in 4..6 && pin.length == expected) tryPin()
        }
        return view
    }

    private fun tryPin() {
        val candidate = pin.toString()
        if (!SecureStore.verifyPin(context, candidate)) {
            wrongAttempts++
            pin.setLength(0)
            refreshDots()
            if (wrongAttempts >= MAX_ATTEMPTS) {
                lockedOutUntil = System.currentTimeMillis() + LOCKOUT_MS
                wrongAttempts = 0
                statusView?.text = context.getString(R.string.vl_too_many)
                handler.postDelayed({
                    statusView?.text = context.getString(R.string.vl_say_unlock)
                }, LOCKOUT_MS)
            } else {
                statusView?.text = context.getString(R.string.vl_wrong_pin)
            }
            return
        }

        pin.setLength(0)
        onUnlocked?.invoke("pin")
        hide()
    }

    private fun refreshDots() {
        val row = dotsRow ?: return
        val density = context.resources.displayMetrics.density
        val size = (13 * density).toInt()
        val margin = (7 * density).toInt()
        row.removeAllViews()
        repeat(6) { index ->
            row.addView(
                View(context).apply {
                    layoutParams = LinearLayout.LayoutParams(size, size).apply {
                        setMargins(margin, margin, margin, margin)
                    }
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(
                            if (index < pin.length) Palette.accent
                            else Palette.pinEmpty,
                        )
                    }
                },
            )
        }
    }
}
