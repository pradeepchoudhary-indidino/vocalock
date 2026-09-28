package com.indidino.vocalock.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
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
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
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

    private var root: View? = null
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

    /**
     * A rounded fill with the hard edge under it that the rest of the app uses.
     * Two stacked rounded rects, the lower one offset down, rather than a blur.
     */
    private fun pill(fill: Int, edge: Int, radius: Int, drop: Int): LayerDrawable {
        val under = GradientDrawable().apply {
            setColor(edge)
            cornerRadius = radius.toFloat()
        }
        val over = GradientDrawable().apply {
            setColor(fill)
            cornerRadius = radius.toFloat()
        }
        return LayerDrawable(arrayOf(under, over)).apply {
            setLayerInset(0, 0, drop, 0, 0)
            setLayerInset(1, 0, 0, 0, drop)
        }
    }

    @SuppressLint("SetTextI18n")
    private fun buildView(): View {
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        // Key size is derived from the screen rather than fixed, so the pad fits
        // on a small phone instead of pushing the rest of the screen off it.
        val screenW = context.resources.displayMetrics.widthPixels
        val keyW = ((screenW - dp(56) - dp(24)) / 3).coerceIn(dp(64), dp(96))
        val keyH = (keyW * 0.82f).toInt().coerceAtMost(dp(68))

        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(48), dp(28), dp(40))
        }

        clockView = TextView(context).apply {
            text = SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())
            setTextColor(Palette.lockInk)
            textSize = 56f
            includeFontPadding = false
            gravity = Gravity.CENTER
        }
        column.addView(clockView)

        column.addView(
            TextView(context).apply {
                text = context.getString(R.string.vl_locked_by)
                setTextColor(Palette.lockInkFaint)
                textSize = 13f
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, dp(28))
            },
        )

        // The mic indicator and the instruction sit together in one pill, so
        // there is a single thing to read rather than three stacked lines.
        val statusBox = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = pill(Palette.lockSurface, Palette.lockSurfaceEdge, dp(22), dp(4))
            setPadding(dp(20), dp(14), dp(20), dp(16))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
        }
        statusBox.addView(
            TextView(context).apply {
                text = context.getString(R.string.vl_mic_live)
                setTextColor(Palette.accent)
                textSize = 12f
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, dp(4))
            },
        )
        statusView = TextView(context).apply {
            text = context.getString(R.string.vl_say_unlock)
            setTextColor(Palette.lockInkSoft)
            textSize = 15f
            gravity = Gravity.CENTER
        }
        statusBox.addView(statusView)
        column.addView(statusBox)

        dotsRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(0, dp(26), 0, dp(6))
        }
        column.addView(dotsRow)

        pinPad = buildPinPad(::dp, keyW, keyH).apply { visibility = View.GONE }
        column.addView(pinPad)

        val usePin = TextView(context).apply {
            text = context.getString(R.string.vl_use_pin)
            setTextColor(Palette.lockInk)
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(dp(30), dp(15), dp(30), dp(17))
            background = pill(Palette.lockSurface, Palette.lockSurfaceEdge, dp(26), dp(4))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(26) }
            setOnClickListener {
                visibility = View.GONE
                dotsRow?.visibility = View.VISIBLE
                pinPad?.visibility = View.VISIBLE
                refreshDots()
            }
        }
        column.addView(usePin)

        // Everything scrolls. Without this the PIN pad pushes the clock and the
        // status off the top on a short screen, and the two collide on the way.
        val scroller = ScrollView(context).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(
                column,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { gravity = Gravity.CENTER_VERTICAL },
            )
        }

        return FrameLayout(context).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Palette.lockFrom, Palette.lockTo),
            )
            // Swallow every touch so nothing underneath reacts.
            isClickable = true
            isFocusable = true
            addView(
                scroller,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }
    }

    private fun buildPinPad(dp: (Int) -> Int, keyW: Int, keyH: Int): View {
        val grid = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        val rows = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("", "0", "\u232B"),
        )
        rows.forEach { row ->
            val line = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            row.forEach { key ->
                line.addView(buildKey(key, dp, keyW, keyH))
            }
            grid.addView(line)
        }
        return grid
    }

    private fun buildKey(key: String, dp: (Int) -> Int, keyW: Int, keyH: Int): View {
        val view = TextView(context).apply {
            text = key
            setTextColor(Palette.lockInk)
            textSize = 23f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(keyW, keyH).apply {
                setMargins(dp(5), dp(5), dp(5), dp(5))
            }
            if (key.isNotEmpty()) {
                background = pill(Palette.lockSurface, Palette.lockSurfaceEdge, dp(22), dp(4))
            }
        }
        if (key.isEmpty()) return view

        view.setOnClickListener {
            if (System.currentTimeMillis() < lockedOutUntil) return@setOnClickListener
            if (key == "\u232B") {
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
