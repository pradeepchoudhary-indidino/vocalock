package com.indidino.vocalock.ui

import android.graphics.Color

/**
 * The colours the pure-Kotlin screens paint with.
 *
 * LockOverlay and AlertActivity have to run with no WebView alive, so they cannot
 * read src/theme.css and the two palettes are kept in step by hand. Doing it in
 * one object rather than as parseColor literals scattered through the layout code
 * is what keeps that honest — the old literals had been left behind by a redesign
 * and were still painting the pre-pastel blue.
 *
 * These screens are always dark (they appear over a locked phone, at night as
 * often as not), so they use theme.css's dark-mode values regardless of what the
 * user picked in the app.
 */
internal object Palette {

    // Brand gradient: --gradient
    val brandFrom = Color.parseColor("#4A6AE0")
    val brandTo = Color.parseColor("#2F45AD")

    /** Ink for the "Stop alert" button, which is a white pill on the gradient. */
    val onLightBrand = Color.parseColor("#2F45AD")

    // Alert screen text over the gradient.
    val alertSub = Color.parseColor("#DCE4FB")

    // Lock overlay ground: --mock-lock gradient in theme.css.
    val lockFrom = Color.parseColor("#221F3D")
    val lockTo = Color.parseColor("#100E20")

    /** Raised surfaces on the overlay (PIN keys, the phrase pill): --surface dark. */
    val lockSurface = Color.parseColor("#2C2850")

    // Ink on the overlay, mirroring --ink / --ink-soft / --ink-faint (dark).
    val lockInk = Color.parseColor("#F2F0FA")
    val lockInkSoft = Color.parseColor("#C9C4F0")
    val lockInkFaint = Color.parseColor("#9C98C4")

    /** Accent: --lilac-solid (dark), bright enough to read on the overlay. */
    val accent = Color.parseColor("#9880FF")

    /** An unfilled PIN dot: --line-strong against the overlay ground. */
    val pinEmpty = Color.parseColor("#3A3560")
}
