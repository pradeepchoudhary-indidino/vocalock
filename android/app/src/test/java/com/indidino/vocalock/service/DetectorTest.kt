package com.indidino.vocalock.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin
import kotlin.random.Random

/**
 * The clap and whistle detectors against synthetic sound, fed exactly as
 * ListenerService feeds them: 20 ms frames at 16 kHz, whistle detector first,
 * clap detector asking it whether a tone is sounding.
 *
 * Synthetic signals cannot prove detection in a real room, but they pin down
 * the cases that went wrong on a phone: a breathy whistle was not recognised,
 * and its swells were counted as claps on High sensitivity.
 */
class DetectorTest {

    private val rate = ListenerService.SAMPLE_RATE
    private val frame = ListenerService.FRAME_SAMPLES

    private class Result(var claps: Int = 0, var clapAlerts: Int = 0, var whistleAlerts: Int = 0)

    /** Runs [signal] through both detectors after a second of quiet room. */
    private fun run(signal: FloatArray, sensitivityFactor: Float = 3f, whistleOn: Boolean = true): Result {
        val result = Result()
        lateinit var whistle: WhistleDetector
        whistle = WhistleDetector { result.whistleAlerts++ }.apply { fireEnabled = whistleOn }
        val clap = ClapDetector(
            onClap = { result.claps++ },
            onFire = { result.clapAlerts++ },
            suppressed = { now -> whistle.toneActive(now) },
        ).apply {
            thresholdFactor = sensitivityFactor
            clapsRequired = 2
        }
        val audio = room(1.0) + signal + room(1.0)
        val pcm = ShortArray(frame)
        var now = 10_000L
        var i = 0
        while (i + frame <= audio.size) {
            for (k in 0 until frame) pcm[k] = (audio[i + k].coerceIn(-1f, 1f) * 32767).toInt().toShort()
            now += 20
            whistle.accept(pcm, frame, now)
            clap.accept(pcm, frame, now)
            i += frame
        }
        return result
    }

    // ---- signals ---------------------------------------------------------

    private val noise = Random(7)

    private fun room(seconds: Double) = FloatArray((seconds * rate).toInt()) { noise.nextFloat() * 0.004f - 0.002f }

    private fun tone(
        hz: Double,
        seconds: Double,
        amp: Float,
        vibratoHz: Double = 0.0,
        vibratoDepthHz: Double = 0.0,
        tremolo: Float = 0f,
        breath: Float = 0f,
    ): FloatArray {
        var phase = 0.0
        return FloatArray((seconds * rate).toInt()) { n ->
            val t = n.toDouble() / rate
            val f = hz + vibratoDepthHz * sin(2 * PI * vibratoHz * t)
            phase += 2 * PI * f / rate
            // A held whistle wavers in loudness with the breath.
            val swell = 1f - tremolo * (0.5f + 0.5f * sin(2 * PI * 7.0 * t).toFloat())
            val attack = minOf(1f, (t / 0.03).toFloat())
            (amp * swell * attack * sin(phase).toFloat()) + (noise.nextFloat() * 2 - 1) * breath
        }
    }

    private fun claps(count: Int, gapSeconds: Double): FloatArray {
        val one = FloatArray((0.06 * rate).toInt()) { n ->
            (noise.nextFloat() * 2 - 1) * 0.6f * exp(-n / (rate * 0.006)).toFloat()
        }
        val gap = FloatArray((gapSeconds * rate).toInt() - one.size)
        var out = FloatArray(0)
        repeat(count) { out += one + gap }
        return out
    }

    /** Voiced speech: a 140 Hz buzz shaped by formants, broken into syllables. */
    private fun speech(seconds: Double): FloatArray = FloatArray((seconds * rate).toInt()) { n ->
        val t = n.toDouble() / rate
        var s = 0.0
        var h = 1
        while (140.0 * h < 4_000) {
            val f = 140.0 * h
            val formant = exp(-((f - 700) / 250).let { it * it }) +
                0.6 * exp(-((f - 1_200) / 300).let { it * it }) +
                0.4 * exp(-((f - 2_600) / 400).let { it * it })
            s += formant * sin(2 * PI * f * t)
            h++
        }
        val syllables = 0.5 + 0.5 * sin(2 * PI * 4.0 * t)
        (0.08 * s * syllables).toFloat()
    }

    /** A held flute note: 880 Hz with harmonics in the whistle band. */
    private fun flute(seconds: Double): FloatArray {
        val a = tone(880.0, seconds, 0.20f, vibratoHz = 5.0, vibratoDepthHz = 6.0)
        val b = tone(1_760.0, seconds, 0.14f, vibratoHz = 5.0, vibratoDepthHz = 12.0)
        val c = tone(2_640.0, seconds, 0.07f, vibratoHz = 5.0, vibratoDepthHz = 18.0)
        return FloatArray(a.size) { a[it] + b[it] + c[it] }
    }

    // ---- whistles --------------------------------------------------------

    @Test fun cleanWhistleOnABinCentreIsHeard() {
        assertEquals(1, run(tone(1_812.5, 1.2, 0.25f)).whistleAlerts)
    }

    @Test fun cleanWhistleBetweenBinsIsHeard() {
        // 1828 Hz sits half a bin from the nearest centre: the case the old
        // single-bin share could not pass.
        assertEquals(1, run(tone(1_828.0, 1.2, 0.25f)).whistleAlerts)
    }

    @Test fun breathyWaveringWhistleIsHeard() {
        val r = run(tone(1_650.0, 1.5, 0.22f, vibratoHz = 5.0, vibratoDepthHz = 25.0, tremolo = 0.5f, breath = 0.02f))
        assertEquals(1, r.whistleAlerts)
    }

    @Test fun whistleIsNotCountedAsClapsOnHighSensitivity() {
        val r = run(tone(1_650.0, 1.5, 0.22f, vibratoHz = 5.0, vibratoDepthHz = 25.0, tremolo = 0.8f, breath = 0.02f))
        assertEquals("a whistle must not ring as a clap", 0, r.clapAlerts)
    }

    @Test fun whistleIsNotCountedAsClapsEvenWithWhistleAlertsOff() {
        val r = run(
            tone(1_650.0, 1.5, 0.22f, vibratoHz = 5.0, vibratoDepthHz = 25.0, tremolo = 0.8f, breath = 0.02f),
            whistleOn = false,
        )
        assertEquals(0, r.whistleAlerts)
        assertEquals(0, r.clapAlerts)
    }

    // ---- claps -----------------------------------------------------------

    @Test fun twoClapsRing() {
        val r = run(claps(2, 0.35))
        assertEquals(1, r.clapAlerts)
        assertEquals(0, r.whistleAlerts)
    }

    @Test fun twoClapsRingOnMediumSensitivity() {
        assertEquals(1, run(claps(2, 0.35), sensitivityFactor = 5f).clapAlerts)
    }

    @Test fun oneClapDoesNotRing() {
        val r = run(claps(1, 0.35))
        assertTrue(r.claps >= 1)
        assertEquals(0, r.clapAlerts)
    }

    // ---- things that must not ring --------------------------------------

    @Test fun speechIsNeitherWhistleNorClaps() {
        val r = run(speech(2.0))
        assertEquals(0, r.whistleAlerts)
        assertEquals(0, r.clapAlerts)
    }

    @Test fun aHeldFluteNoteIsNotAWhistle() {
        assertEquals(0, run(flute(1.5)).whistleAlerts)
    }
}
