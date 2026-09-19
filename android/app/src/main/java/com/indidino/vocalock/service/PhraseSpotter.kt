package com.indidino.vocalock.service

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.vosk.Recognizer
import kotlin.math.abs
import kotlin.math.min

/**
 * Offline phrase spotting per spec section 4.5.
 *
 * Vosk runs against a grammar limited to the phrases we care about plus [unk],
 * so it is only ever asked "is this one of these, or none of them" — far more
 * accurate and far cheaper than open dictation. The model ships inside the APK,
 * so nothing is downloaded and no audio leaves the device.
 *
 * Also used by setup to check a candidate phrase before saving it: see
 * [armForCheck]. The model comes from [VoskModels], so that check reuses the
 * already-loaded model rather than paying for a second copy.
 */
class PhraseSpotter(
    private val context: Context,
    private val onMatch: (target: Target) -> Unit,
) {

    enum class Target { LOCK, UNLOCK, CHECK }

    companion object {
        private const val TAG = "PhraseSpotter"

        /**
         * How much of a phrase may be misheard, as a fraction of its length.
         *
         * This used to be one edit per WORD, which on short phrases is far too
         * generous: "lock now" and "unlock now" are two edits apart, so a
         * two-word phrase would accept the other one outright.
         */
        private const val EDIT_TOLERANCE_RATIO = 0.2f
        private const val MAX_EDITS = 3

        /** Do not act on the same phrase twice in quick succession. */
        private const val REPEAT_GUARD_MS = 2_500L
    }

    /**
     * Guards every use of [recognizer]. Vosk's Recognizer wraps a native object:
     * closing it while the audio thread is inside acceptWaveForm is a
     * use-after-free, and it lands as a SIGSEGV rather than an exception.
     */
    private val lock = Any()

    @Volatile
    private var recognizer: Recognizer? = null

    private var lockPhrase = ""
    private var unlockPhrase = ""
    private var checkPhrase = ""

    /** When the lock is up, only the unlock phrase is accepted. */
    @Volatile
    var lockedMode = false

    /** True while armed for a setup phrase check rather than for locking. */
    @Volatile
    var checking = false
        private set

    private var lastFiredAt = 0L

    val isReady: Boolean get() = recognizer != null

    /** Arms the lock and unlock phrases. Slow on first call — background thread. */
    fun arm(language: String, lock: String, unlock: String): Boolean {
        lockPhrase = normalize(lock)
        unlockPhrase = normalize(unlock)
        checkPhrase = ""
        checking = false
        if (lockPhrase.isEmpty() || unlockPhrase.isEmpty()) {
            release()
            return false
        }
        return build(language, listOf(lockPhrase, unlockPhrase))
    }

    /**
     * Arms a single candidate phrase so setup can prove the model can actually
     * hear it before saving it. Watch logcat for Vosk's "Ignoring word missing
     * in vocabulary" when this fails.
     */
    fun armForCheck(language: String, phrase: String): Boolean {
        checkPhrase = normalize(phrase)
        checking = true
        if (checkPhrase.isEmpty()) {
            release()
            return false
        }
        return build(language, listOf(checkPhrase))
    }

    private fun build(language: String, phrases: List<String>): Boolean = try {
        // Both of these are slow, so they happen outside the lock; only the swap
        // itself blocks the audio thread, and only for a moment.
        val model = VoskModels.model(context, language)
        val fresh = Recognizer(
            model,
            ListenerService.SAMPLE_RATE.toFloat(),
            grammarOf(phrases),
        )
        synchronized(lock) {
            recognizer?.close()
            recognizer = fresh
        }
        lastFiredAt = 0L
        true
    } catch (e: Throwable) {
        // Throwable, not Exception: a missing or unloadable libvosk.so arrives
        // as UnsatisfiedLinkError, and it must not take the service down.
        Log.e(TAG, "could not arm Vosk", e)
        release()
        false
    }

    /**
     * Clears the decoder's partial state. Called when the speech gate reopens
     * after a silence, so half-heard audio from before the gap cannot combine
     * with the new utterance into a false match.
     */
    fun resetStream() {
        synchronized(lock) {
            runCatching { recognizer?.reset() }
        }
    }

    fun release() {
        synchronized(lock) {
            runCatching { recognizer?.close() }
            recognizer = null
        }
        checking = false
    }

    /** Feeds one PCM frame. Returns true if a phrase fired on this frame. */
    fun accept(frame: ShortArray, length: Int, nowMs: Long): Boolean {
        if (recognizer == null) return false

        val text = synchronized(lock) {
            val active = recognizer ?: return false
            try {
                // The short[] overload takes our PCM frame as-is; the byte[] one
                // would mean packing a new array 50 times a second on the audio
                // thread.
                if (active.acceptWaveForm(frame, length)) {
                    JSONObject(active.result).optString("text")
                } else {
                    // Partials let us react without waiting for end-of-utterance
                    // silence.
                    JSONObject(active.partialResult).optString("partial")
                }
            } catch (e: Throwable) {
                Log.w(TAG, "recognizer error", e)
                return false
            }
        }

        if (text.isNullOrBlank()) return false
        // Matching, and the callbacks it fires, happen outside the lock so a
        // slow callback cannot stall a re-arm.
        return match(normalize(text), nowMs)
    }

    private fun match(heard: String, nowMs: Long): Boolean {
        if (nowMs - lastFiredAt < REPEAT_GUARD_MS) return false

        if (checking) {
            if (!matches(heard, checkPhrase)) return false
            lastFiredAt = nowMs
            onMatch(Target.CHECK)
            return true
        }

        // Exactly one phrase can do anything in a given state, so only that one
        // is considered. Testing both was what let "lock now" be swallowed as a
        // near-miss of "unlock now" and then do nothing, because there was
        // nothing to unlock.
        if (lockedMode) {
            if (!matches(heard, unlockPhrase)) return false
            lastFiredAt = nowMs
            onMatch(Target.UNLOCK)
            return true
        }

        if (!matches(heard, lockPhrase)) return false
        lastFiredAt = nowMs
        onMatch(Target.LOCK)
        return true
    }

    private fun matches(heard: String, target: String): Boolean {
        if (target.isEmpty() || heard.isEmpty()) return false
        if (heard == target) return true
        // Whole-word containment only. A bare substring test makes any phrase
        // that contains another one match it — "lock now" inside "unlock now".
        if (containsWords(heard, target)) return true

        val tolerance = toleranceFor(target)
        // A phrase that is materially longer or shorter is a different phrase;
        // checking this first also skips the edit-distance work.
        if (abs(heard.length - target.length) > tolerance) return false
        return editDistance(heard, target) <= tolerance
    }

    private fun toleranceFor(target: String): Int =
        (target.length * EDIT_TOLERANCE_RATIO).toInt().coerceIn(1, MAX_EDITS)

    /** True when [target]'s words appear consecutively in [heard]. */
    private fun containsWords(heard: String, target: String): Boolean {
        val haystack = heard.split(' ')
        val needle = target.split(' ')
        if (needle.isEmpty() || needle.size > haystack.size) return false
        for (start in 0..haystack.size - needle.size) {
            if ((needle.indices).all { haystack[start + it] == needle[it] }) return true
        }
        return false
    }

    /** Two phrases this close cannot be reliably separated by the matcher. */
    fun tooSimilar(a: String, b: String): Boolean {
        val na = normalize(a)
        val nb = normalize(b)
        if (na.isEmpty() || nb.isEmpty()) return true
        // One phrase wholly inside the other is confusable however far apart
        // they are by edit distance: "lock it" is inside "lock it now".
        if (containsWords(na, nb) || containsWords(nb, na)) return true
        val threshold = maxOf(toleranceFor(na), toleranceFor(nb)) + 1
        return editDistance(na, nb) <= threshold
    }

    /** Vosk takes a JSON array of allowed utterances; [unk] absorbs the rest. */
    private fun grammarOf(phrases: List<String>): String {
        val escaped = phrases.toSet()
            .filter { it.isNotEmpty() }
            .joinToString(",") { "\"${it.replace("\"", "")}\"" }
        return "[$escaped,\"[unk]\"]"
    }

    /**
     * Must stay in step with normalizePhrase() in src/store/voiceSetup.ts.
     *
     * \p{M} matters: Devanagari vowel signs and anusvara are combining marks,
     * not letters, so a letters-only filter turns "करो" into "कर" and "बंद"
     * into "बद" — words no Hindi model has ever seen.
     */
    private fun normalize(text: String): String =
        text.lowercase()
            .replace(Regex("[^\\p{L}\\p{N}\\p{M}\\s]"), "")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun editDistance(a: String, b: String): Int {
        if (a == b) return 0
        var previous = IntArray(b.length + 1) { it }
        var current = IntArray(b.length + 1)
        for (i in 1..a.length) {
            current[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                current[j] = min(
                    min(current[j - 1] + 1, previous[j] + 1),
                    previous[j - 1] + cost,
                )
            }
            val swap = previous
            previous = current
            current = swap
        }
        return previous[b.length]
    }
}
