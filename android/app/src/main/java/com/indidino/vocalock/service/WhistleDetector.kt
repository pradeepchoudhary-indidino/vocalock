package com.indidino.vocalock.service

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Whistle detection per spec section 4.4.
 *
 * A whistle is close to a pure tone: almost all of its energy sits in one narrow
 * peak between 1 and 4 kHz, and it is held. Speech and music spread their energy
 * across the spectrum, which is what spectral flatness measures — so "one strong
 * peak in band, low flatness, held for 300 ms" separates a whistle from a voice
 * without needing anything heavier than an FFT per frame.
 *
 * It also reports when any such tone is sounding, whether or not whistle alerts
 * are on, because the clap detector needs to know: a breathy whistle swells and
 * dips, and each swell looks like a short bright burst.
 */
class WhistleDetector(private val onFire: () -> Unit) {

    companion object {
        /** 512 bins at 16 kHz gives ~31 Hz resolution, plenty for a 1–4 kHz peak. */
        private const val FFT_SIZE = 512
        private const val BIN_HZ = ListenerService.SAMPLE_RATE.toFloat() / FFT_SIZE

        private const val MIN_HZ = 1_000f
        private const val MAX_HZ = 4_000f

        /**
         * The tone's main lobe must hold this share of the in-band POWER.
         *
         * Measured over the lobe (peak ±2 bins), not the single peak bin: the Hann
         * window spreads even a perfect tone across about three bins, so a
         * one-bin share topped out near 0.5 for a tone on a bin centre and fell
         * to ~0.38 between bins. With the threshold at 0.45 most real whistles,
         * which also carry breath noise, never registered. Power rather than
         * magnitude makes a tone stand out from noise by the square.
         */
        private const val MIN_LOBE_SHARE = 0.6f
        private const val LOBE_BINS = 2

        /**
         * A whistle has nothing at half its pitch. A voice or an instrument whose
         * harmonic lands in band does — its fundamental — which is what caught
         * background music before.
         */
        private const val MAX_SUBHARMONIC_SHARE = 0.2f

        /** How long after the last tonal frame [toneActive] still answers yes. */
        private const val TONE_MEMORY_MS = 400L

        /**
         * Spectral flatness (Wiener entropy): geometric over arithmetic mean of the
         * in-band POWER. White noise sits near 0.56, voiced speech around 0.05 to
         * 0.2, a whistle with breath noise at 0.002 to 0.02. It used to be taken
         * over magnitudes with a limit of 0.22, which a breathy whistle crossed
         * in every dip of its swell, resetting the hold before it could fire.
         */
        private const val MAX_FLATNESS = 0.05f

        /** Ignore near-silence. */
        private const val MIN_LEVEL = 0.012f

        private const val HOLD_MS = 300L
        private const val MAX_DRIFT_BINS = 3
        private const val COOLDOWN_MS = 4_000L
    }

    private val window = FloatArray(FFT_SIZE) {
        // Hann window: keeps a steady tone from smearing across neighbouring bins.
        0.5f - 0.5f * cos(2.0 * Math.PI * it / (FFT_SIZE - 1)).toFloat()
    }
    private val buffer = FloatArray(FFT_SIZE)
    private var filled = 0

    private val real = FloatArray(FFT_SIZE)
    private val imag = FloatArray(FFT_SIZE)
    private val power = FloatArray(FFT_SIZE / 2)

    private var holdingSince = 0L
    private var holdBin = -1
    private var cooldownUntil = 0L
    private var lastToneAt = Long.MIN_VALUE / 2

    /** Off when the user has whistle detection switched off; tones are still tracked. */
    var fireEnabled = true

    /** Whether a whistle-like tone is sounding now, or was a moment ago. */
    fun toneActive(nowMs: Long): Boolean = nowMs - lastToneAt <= TONE_MEMORY_MS

    fun reset() {
        filled = 0
        holdingSince = 0L
        holdBin = -1
    }

    fun accept(frame: ShortArray, length: Int, nowMs: Long) {
        var i = 0
        while (i < length) {
            val take = minOf(FFT_SIZE - filled, length - i)
            for (j in 0 until take) buffer[filled + j] = frame[i + j] / 32768f
            filled += take
            i += take
            if (filled == FFT_SIZE) {
                analyse(nowMs)
                // 50% overlap so a short whistle is not missed between windows.
                System.arraycopy(buffer, FFT_SIZE / 2, buffer, 0, FFT_SIZE / 2)
                filled = FFT_SIZE / 2
            }
        }
    }

    private fun analyse(nowMs: Long) {
        // Check loudness before transforming, not after. The FFT is the
        // expensive part of this class and a quiet room does not need one —
        // this alone removes most of the work in normal use.
        var energy = 0f
        for (k in 0 until FFT_SIZE) energy += buffer[k] * buffer[k]
        if (sqrt(energy / FFT_SIZE) < MIN_LEVEL) {
            holdBin = -1
            return
        }

        for (k in 0 until FFT_SIZE) {
            real[k] = buffer[k] * window[k]
            imag[k] = 0f
        }
        fft(real, imag)

        for (k in power.indices) power[k] = real[k] * real[k] + imag[k] * imag[k]

        val lowBin = (MIN_HZ / BIN_HZ).toInt()
        val highBin = minOf((MAX_HZ / BIN_HZ).toInt(), power.size - 1)

        var peakBin = lowBin
        var peakPower = 0f
        var bandPower = 0f
        var logSum = 0.0
        var count = 0
        for (k in lowBin..highBin) {
            bandPower += power[k]
            logSum += ln((power[k] + 1e-12f).toDouble())
            count++
            if (power[k] > peakPower) {
                peakPower = power[k]
                peakBin = k
            }
        }
        if (bandPower <= 0f || count == 0) {
            holdBin = -1
            return
        }

        val lobePower = lobe(peakBin)
        val lobeShare = lobePower / bandPower
        val subharmonicShare = lobe(peakBin / 2) / lobePower
        val arithmeticMean = bandPower / count
        val geometricMean = Math.exp(logSum / count).toFloat()
        val flatness = if (arithmeticMean > 0f) geometricMean / arithmeticMean else 1f

        val isTone = lobeShare >= MIN_LOBE_SHARE &&
            flatness <= MAX_FLATNESS &&
            subharmonicShare <= MAX_SUBHARMONIC_SHARE
        if (!isTone) {
            holdBin = -1
            return
        }
        lastToneAt = nowMs

        // The same tone has to persist; a bin that jumps around is not a whistle.
        if (holdBin < 0 || abs(peakBin - holdBin) > MAX_DRIFT_BINS) {
            holdBin = peakBin
            holdingSince = nowMs
            return
        }
        holdBin = peakBin

        if (fireEnabled && nowMs - holdingSince >= HOLD_MS && nowMs >= cooldownUntil) {
            cooldownUntil = nowMs + COOLDOWN_MS
            holdBin = -1
            onFire()
        }
    }

    /** Power in the main lobe around [bin]: where a windowed pure tone lands. */
    private fun lobe(bin: Int): Float {
        var sum = 0f
        for (k in maxOf(0, bin - LOBE_BINS)..minOf(power.size - 1, bin + LOBE_BINS)) sum += power[k]
        return sum
    }

    /** In-place radix-2 Cooley–Tukey. FFT_SIZE is a power of two. */
    private fun fft(re: FloatArray, im: FloatArray) {
        val n = re.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j or bit
            if (i < j) {
                var tmp = re[i]; re[i] = re[j]; re[j] = tmp
                tmp = im[i]; im[i] = im[j]; im[j] = tmp
            }
        }

        var len = 2
        while (len <= n) {
            val angle = -2.0 * Math.PI / len
            val wReal = cos(angle).toFloat()
            val wImag = sin(angle).toFloat()
            var i = 0
            while (i < n) {
                var curReal = 1f
                var curImag = 0f
                for (k in 0 until len / 2) {
                    val uRe = re[i + k]
                    val uIm = im[i + k]
                    val vRe = re[i + k + len / 2] * curReal - im[i + k + len / 2] * curImag
                    val vIm = re[i + k + len / 2] * curImag + im[i + k + len / 2] * curReal
                    re[i + k] = uRe + vRe
                    im[i + k] = uIm + vIm
                    re[i + k + len / 2] = uRe - vRe
                    im[i + k + len / 2] = uIm - vIm
                    val nextReal = curReal * wReal - curImag * wImag
                    curImag = curReal * wImag + curImag * wReal
                    curReal = nextReal
                }
                i += len
            }
            len = len shl 1
        }
    }
}
