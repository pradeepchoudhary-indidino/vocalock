package com.indidino.vocalock.service

import kotlin.math.sqrt

/**
 * Decides when the room is worth handing to Vosk.
 *
 * Vosk runs a neural acoustic model. Feeding it every frame around the clock is
 * the single most expensive thing this app does, and almost all of that work is
 * spent transcribing silence. This gate is a cheap energy-based voice-activity
 * detector: one pass over the frame, negligible next to a DNN.
 *
 * The subtlety is the start of an utterance. A gate that opens only once speech
 * is detected has already swallowed the first syllable, and a phrase spotter
 * with a missing first syllable never matches. So it keeps a short rolling
 * pre-roll of raw audio and replays it the moment the gate opens.
 */
class SpeechGate {

    companion object {
        /** Audio kept back so the start of a phrase is never lost. */
        private const val PRE_ROLL_MS = 400

        /**
         * Keep feeding after speech stops. Generously long: missing the tail of
         * a phrase costs a failed unlock, while a little extra decoding costs
         * almost nothing.
         */
        private const val HANGOVER_MS = 1_200

        /** Deliberately low. Over-feeding is cheap; missing a phrase is not. */
        private const val OPEN_FACTOR = 2.0f

        /** Below this the mic is effectively silent whatever the floor says. */
        private const val ABSOLUTE_FLOOR = 0.004f

        private const val FLOOR_RISE = 0.003f
        private const val FLOOR_FALL = 0.05f

        private const val PRE_ROLL_SAMPLES = PRE_ROLL_MS * ListenerService.SAMPLE_RATE / 1000
    }

    enum class Decision {
        /** Nothing worth decoding; skip the recogniser entirely. */
        SILENT,

        /** Speech just started — replay [preRoll] first, then this frame. */
        OPENED,

        /** Still inside an utterance (or its hangover); feed this frame. */
        OPEN,
    }

    private val preRollBuffer = ShortArray(PRE_ROLL_SAMPLES)
    private var preRollWrite = 0
    private var preRollFilled = 0

    /** Scratch for handing the pre-roll out contiguously, allocated once. */
    private val preRollOut = ShortArray(PRE_ROLL_SAMPLES)

    private var noiseFloor = ABSOLUTE_FLOOR
    private var openUntilMs = 0L
    private var wasOpen = false

    fun reset() {
        preRollWrite = 0
        preRollFilled = 0
        noiseFloor = ABSOLUTE_FLOOR
        openUntilMs = 0L
        wasOpen = false
    }

    fun update(frame: ShortArray, length: Int, nowMs: Long): Decision {
        var energy = 0f
        for (i in 0 until length) {
            val sample = frame[i] / 32768f
            energy += sample * sample
        }
        val level = sqrt(energy / length)

        val trigger = (noiseFloor * OPEN_FACTOR).coerceAtLeast(ABSOLUTE_FLOOR)
        if (level > trigger) {
            openUntilMs = nowMs + HANGOVER_MS
        } else {
            // Only learn the room while it is quiet, so speech cannot drag the
            // floor up behind it and gate itself out.
            val rate = if (level > noiseFloor) FLOOR_RISE else FLOOR_FALL
            noiseFloor += (level - noiseFloor) * rate
            if (noiseFloor < ABSOLUTE_FLOOR) noiseFloor = ABSOLUTE_FLOOR
        }

        val open = nowMs < openUntilMs
        val decision = when {
            !open -> Decision.SILENT
            !wasOpen -> Decision.OPENED
            else -> Decision.OPEN
        }
        wasOpen = open

        // Always record: the pre-roll has to already hold the audio from before
        // the gate opened, which is the whole point of it.
        appendToPreRoll(frame, length)
        return decision
    }

    /**
     * The audio immediately before the gate opened, oldest first. Only
     * meaningful right after [Decision.OPENED]; the contents are overwritten by
     * the next [update].
     */
    fun preRoll(): ShortArray {
        if (preRollFilled < PRE_ROLL_SAMPLES) {
            System.arraycopy(preRollBuffer, 0, preRollOut, 0, preRollFilled)
            return preRollOut
        }
        val tail = PRE_ROLL_SAMPLES - preRollWrite
        System.arraycopy(preRollBuffer, preRollWrite, preRollOut, 0, tail)
        System.arraycopy(preRollBuffer, 0, preRollOut, tail, preRollWrite)
        return preRollOut
    }

    fun preRollLength(): Int = preRollFilled

    private fun appendToPreRoll(frame: ShortArray, length: Int) {
        var offset = 0
        var remaining = length
        while (remaining > 0) {
            val chunk = minOf(remaining, PRE_ROLL_SAMPLES - preRollWrite)
            System.arraycopy(frame, offset, preRollBuffer, preRollWrite, chunk)
            preRollWrite = (preRollWrite + chunk) % PRE_ROLL_SAMPLES
            offset += chunk
            remaining -= chunk
            if (preRollFilled < PRE_ROLL_SAMPLES) {
                preRollFilled = minOf(PRE_ROLL_SAMPLES, preRollFilled + chunk)
            }
        }
    }
}
