package com.indidino.vocalock.service

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Clap detection per spec section 4.3.
 *
 * Works on 2.5 ms sub-blocks rather than whole 20 ms frames, because a clap's
 * defining feature is a rise time under 10 ms and a 20 ms frame cannot resolve
 * that. For each block we track loudness and a cheap high-frequency ratio; the
 * combination of "very sudden", "very short" and "bright" is what separates a
 * clap from speech, a door thud or a bass note.
 */
class ClapDetector(
    /** Called for every accepted clap with its position in the current chain. */
    private val onClap: (chainCount: Int) -> Unit,
    /** Called when enough claps have landed close enough together. */
    private val onFire: () -> Unit,
) {

    companion object {
        /** 2.5 ms at 16 kHz. */
        const val BLOCK_SAMPLES = 40
        private const val BLOCK_MS = BLOCK_SAMPLES * 1000f / ListenerService.SAMPLE_RATE

        /** A clap peaks this fast or it is not a clap. */
        private const val MAX_RISE_MS = 10f

        /** And it is over this fast. */
        private const val MAX_BURST_MS = 100f

        /** Rejects speech and thuds, which put their energy lower down. */
        private const val MIN_HF_RATIO = 0.30f

        /** Below this the mic is effectively silent; do not chase the floor. */
        private const val SILENCE_FLOOR = 0.0012f

        /** Noise-floor smoothing, applied per block outside a burst. */
        private const val FLOOR_RISE = 0.004f
        private const val FLOOR_FALL = 0.05f

        private const val MIN_GAP_MS = 150L
        private const val MAX_GAP_MS = 600L
        private const val WINDOW_MS = 2_000L
        private const val COOLDOWN_MS = 3_000L
    }

    private enum class State { IDLE, BURST }

    var thresholdFactor: Float = 5f
    var clapsRequired: Int = 2

    private var noiseFloor = 0.01f
    private var state = State.IDLE
    private var previousSample = 0f

    // Burst bookkeeping, all in block counts.
    private var burstBlocks = 0
    private var blocksSincePeak = 0
    private var peakLevel = 0f
    private var onsetLevel = 0f
    private var hfSum = 0f
    private var levelSum = 0f

    private var chain = 0
    private var lastClapAt = 0L
    private var chainStartedAt = 0L
    private var cooldownUntil = 0L

    /** Level of the most recent frame, 0..1, for the calibration meter. */
    var lastFrameLevel = 0f
        private set

    fun reset() {
        state = State.IDLE
        chain = 0
        burstBlocks = 0
        noiseFloor = 0.01f
        previousSample = 0f
    }

    /**
     * Feeds one PCM frame. [length] samples of [frame] are used.
     * [nowMs] is elapsed-realtime millis at the end of the frame.
     */
    fun accept(frame: ShortArray, length: Int, nowMs: Long) {
        var framePeak = 0f
        var block = 0
        while (block + BLOCK_SAMPLES <= length) {
            var energy = 0f
            var hfEnergy = 0f
            for (i in block until block + BLOCK_SAMPLES) {
                val sample = frame[i] / 32768f
                energy += sample * sample
                // First-order difference is a +6 dB/octave high-pass: a cheap
                // stand-in for "how much of this block is high frequency".
                val diff = sample - previousSample
                hfEnergy += diff * diff
                previousSample = sample
            }
            val level = sqrt(energy / BLOCK_SAMPLES)
            val hfLevel = sqrt(hfEnergy / BLOCK_SAMPLES)
            if (level > framePeak) framePeak = level
            step(level, hfLevel, nowMs)
            block += BLOCK_SAMPLES
        }
        lastFrameLevel = framePeak.coerceIn(0f, 1f)
    }

    private fun step(level: Float, hfLevel: Float, nowMs: Long) {
        val trigger = (noiseFloor * thresholdFactor).coerceAtLeast(SILENCE_FLOOR * thresholdFactor)

        when (state) {
            State.IDLE -> {
                if (level > trigger) {
                    state = State.BURST
                    burstBlocks = 1
                    blocksSincePeak = 0
                    peakLevel = level
                    onsetLevel = level
                    hfSum = hfLevel
                    levelSum = level
                } else {
                    // Track the room: rise slowly, fall faster, so a burst does
                    // not drag the floor up behind it.
                    val rate = if (level > noiseFloor) FLOOR_RISE else FLOOR_FALL
                    noiseFloor += (level - noiseFloor) * rate
                    if (noiseFloor < SILENCE_FLOOR) noiseFloor = SILENCE_FLOOR
                }
            }

            State.BURST -> {
                burstBlocks++
                hfSum += hfLevel
                levelSum += level
                if (level > peakLevel) {
                    peakLevel = level
                    blocksSincePeak = 0
                } else {
                    blocksSincePeak++
                }

                val decayed = level < maxOf(noiseFloor * 2f, peakLevel * 0.25f)
                val tooLong = burstBlocks * BLOCK_MS > MAX_BURST_MS

                if (decayed || tooLong) {
                    val riseMs = (burstBlocks - blocksSincePeak) * BLOCK_MS
                    val burstMs = burstBlocks * BLOCK_MS
                    val hfRatio = if (levelSum > 0f) hfSum / levelSum else 0f
                    val sharp = peakLevel > onsetLevel * 1.5f || onsetLevel >= peakLevel
                    if (!tooLong &&
                        riseMs <= MAX_RISE_MS &&
                        burstMs <= MAX_BURST_MS &&
                        hfRatio >= MIN_HF_RATIO &&
                        sharp
                    ) {
                        registerClap(nowMs)
                    }
                    state = State.IDLE
                    burstBlocks = 0
                }
            }
        }
    }

    private fun registerClap(nowMs: Long) {
        if (nowMs < cooldownUntil) return

        val gap = nowMs - lastClapAt
        val continues = chain > 0 &&
            gap in MIN_GAP_MS..MAX_GAP_MS &&
            nowMs - chainStartedAt <= WINDOW_MS

        if (continues) {
            chain++
        } else {
            chain = 1
            chainStartedAt = nowMs
        }
        lastClapAt = nowMs
        onClap(chain)

        if (chain >= clapsRequired) {
            chain = 0
            cooldownUntil = nowMs + COOLDOWN_MS
            onFire()
        }
    }

    /** Peak amplitude of the last frame, for callers that only want a meter. */
    fun levelOf(frame: ShortArray, length: Int): Float {
        var peak = 0
        for (i in 0 until length) {
            val magnitude = abs(frame[i].toInt())
            if (magnitude > peak) peak = magnitude
        }
        return (peak / 32768f).coerceIn(0f, 1f)
    }
}
