package com.indidino.vocalock.ui

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
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
import androidx.appcompat.app.AppCompatActivity
import com.indidino.vocalock.R
import com.indidino.vocalock.service.LockController
import com.indidino.vocalock.service.SecureStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The lock screen, as an Activity so it can enter Lock Task Mode.
 *
 * The overlay version could be escaped by pulling down the notification shade
 * and walking to Settings. No app can block the shade from an overlay window —
 * but a pinned Activity is a different thing: the system itself disables the
 * shade, Home and Recents while lock task is active.
 *
 * It is not a prison, deliberately. Without Device Owner, Android lets the user
 * leave by holding Back and Overview together, and shows its own "Screen
 * pinned" confirmation on the way in. Google does not permit a consumer app to
 * trap someone, and this app is a focus tool anyway — the point is to make
 * leaving a decision rather than a reflex.
 */
class LockActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "LockActivity"
        private const val MAX_ATTEMPTS = 5
        private const val LOCKOUT_MS = 30_000L

        private var live: LockActivity? = null

        fun show(context: Context) {
            context.startActivity(
                Intent(context, LockActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK,
                ),
            )
        }

        /** The spoken unlock phrase was heard; close from wherever we are. */
        fun dismiss() {
            live?.let { activity -> activity.runOnUiThread { activity.leave() } }
        }

        val isShowing: Boolean get() = live != null
    }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private lateinit var status: TextView
    private lateinit var dots: LinearLayout
    private lateinit var pad: View
    private lateinit var usePin: TextView

    private val pin = StringBuilder()
    private var wrongAttempts = 0
    private var lockedOutUntil = 0L

    private val clockTick = object : Runnable {
        override fun run() {
            clock.text = SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())
            handler.postDelayed(this, 10_000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.VocaLockFullScreen)
        showOverKeyguard()
        setContentView(buildView())
        // Only after setContentView: the insets controller comes from the
        // DecorView, which does not exist until there is a content view, and
        // asking for it earlier throws.
        hideSystemBars()
        live = this
        handler.post(clockTick)
        enterLockTask()
    }

    override fun onDestroy() {
        if (live === this) live = null
        handler.removeCallbacks(clockTick)
        super.onDestroy()
    }

    /** Back must not dismiss the lock; that is what the PIN is for. */
    @Deprecated("Kept for API < 33; the PIN or the unlock phrase is the way out.")
    override fun onBackPressed() {
        // Intentionally ignored.
    }

    /**
     * Pinning is best-effort: it can be refused by policy or by the OEM, and it
     * is not worth failing the lock over. A lock the user can leave is far
     * better than no lock at all.
     */
    private fun enterLockTask() {
        try {
            startLockTask()
        } catch (e: IllegalStateException) {
            Log.w(TAG, "lock task refused; falling back to a plain full-screen lock", e)
        }
    }

    private fun inLockTask(): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
        } else {
            false
        }
    }

    private fun leave() {
        if (inLockTask()) runCatching { stopLockTask() }
        finish()
    }

    private fun showOverKeyguard() {
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

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    // ----- view -----

    private fun buildView(): View {
        val density = resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(40), dp(28), dp(40))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#221F3D"), Color.parseColor("#100E20")),
            )
        }

        clock = TextView(this).apply {
            text = SimpleDateFormat("h:mm", Locale.getDefault()).format(Date())
            setTextColor(Color.WHITE)
            textSize = 52f
            gravity = Gravity.CENTER
        }
        root.addView(clock)

        root.addView(
            TextView(this).apply {
                text = getString(R.string.vl_locked_by)
                setTextColor(Color.parseColor("#9C98C4"))
                textSize = 13f
                gravity = Gravity.CENTER
                setPadding(0, dp(6), 0, dp(34))
            },
        )

        status = TextView(this).apply {
            text = getString(R.string.vl_say_unlock)
            setTextColor(Color.parseColor("#C9C4F0"))
            textSize = 15f
            gravity = Gravity.CENTER
        }
        root.addView(status)

        // A quiet, always-visible sign that the microphone is live, so the user
        // is never listened to without being told.
        root.addView(
            TextView(this).apply {
                text = getString(R.string.vl_mic_live)
                setTextColor(Color.parseColor("#7358E0"))
                textSize = 12f
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, dp(26))
            },
        )

        dots = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            visibility = View.GONE
        }
        root.addView(dots)

        pad = buildPad(::dp).apply { visibility = View.GONE }
        root.addView(pad)

        usePin = TextView(this).apply {
            text = getString(R.string.vl_use_pin)
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(14), dp(28), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#2C2850"))
                cornerRadius = dp(24).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(10) }
            setOnClickListener {
                visibility = View.GONE
                dots.visibility = View.VISIBLE
                pad.visibility = View.VISIBLE
                refreshDots()
            }
        }
        root.addView(usePin)

        return root
    }

    private fun buildPad(dp: (Int) -> Int): View {
        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("", "0", "⌫"),
        ).forEach { row ->
            val line = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            row.forEach { line.addView(buildKey(it, dp)) }
            grid.addView(line)
        }
        return grid
    }

    private fun buildKey(key: String, dp: (Int) -> Int): View {
        val view = TextView(this).apply {
            text = key
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(72), dp(62)).apply {
                setMargins(dp(6), dp(6), dp(6), dp(6))
            }
            if (key.isNotEmpty()) {
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#2C2850"))
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
            val expected = SecureStore.pinLength(this)
            if (expected in 4..6 && pin.length == expected) tryPin()
        }
        return view
    }

    private fun tryPin() {
        if (!SecureStore.verifyPin(this, pin.toString())) {
            wrongAttempts++
            pin.setLength(0)
            refreshDots()
            if (wrongAttempts >= MAX_ATTEMPTS) {
                lockedOutUntil = System.currentTimeMillis() + LOCKOUT_MS
                wrongAttempts = 0
                status.text = getString(R.string.vl_too_many)
                handler.postDelayed({ status.text = getString(R.string.vl_say_unlock) }, LOCKOUT_MS)
            } else {
                status.text = getString(R.string.vl_wrong_pin)
            }
            return
        }
        pin.setLength(0)
        LockController.unlock(this)
        leave()
    }

    private fun refreshDots() {
        val density = resources.displayMetrics.density
        val size = (13 * density).toInt()
        val margin = (7 * density).toInt()
        dots.removeAllViews()
        repeat(6) { index ->
            dots.addView(
                View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(size, size).apply {
                        setMargins(margin, margin, margin, margin)
                    }
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(
                            if (index < pin.length) Color.parseColor("#7358E0")
                            else Color.parseColor("#3A3560"),
                        )
                    }
                },
            )
        }
    }
}
