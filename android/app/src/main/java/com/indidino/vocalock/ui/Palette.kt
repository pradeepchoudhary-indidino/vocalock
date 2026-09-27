package com.indidino.vocalock.ui

import android.graphics.Color

/**
 * The colours the pure-Kotlin screens paint with.
 *
 * LockOverlay and AlertActivity have to run with no WebView alive, so they
 * cannot read src/theme.css and the two palettes are kept in step by hand.
 * Doing it in one object rather than as parseColor literals scattered through
 * the layout code is what keeps that honest — the old literals had been left
 * behind by a redesign and were still painting a pre-redesign blue.
 *
 * These screens are always dark: they appear over a locked phone, as often at
 * night as not. So they use the dark values regardless of the user's theme.
 */
internal object Palette {

    /* ---- the alert, "Phone found" -------------------------------------
       Its own gradient in the design, deeper than the app's blue so a white
       headline reads on it at any point. */
    val alertTop = Color.parseColor("#124682")
    val alertMid = Color.parseColor("#1663BD")
    val alertBottom = Color.parseColor("#0F2F55")

    /** Ink on the white "Stop alert" pill: brand-deep, 7.9:1 on white. */
    val onLightBrand = Color.parseColor("#07509D")

    /** Supporting white on the alert gradient. */
    val alertSub = Color.parseColor("#DCE4FB")

    /* ---- the lock overlay ---------------------------------------------
       The purple flow, since Voice Lock is what raises it. */
    val lockFrom = Color.parseColor("#1D1840")
    val lockTo = Color.parseColor("#0E0B1E")

    /** Raised surfaces: PIN keys, the phrase pill. */
    val lockSurface = Color.parseColor("#2C2850")

    /** The hard bottom edge under those surfaces — the design's defining move. */
    val lockSurfaceEdge = Color.parseColor("#1B1733")

    // Ink on the overlay.
    val lockInk = Color.parseColor("#F2F0FA")
    val lockInkSoft = Color.parseColor("#C9C4F0")
    val lockInkFaint = Color.parseColor("#9C98C4")

    /** Accent: the purple flow's solid, bright enough to read on the overlay. */
    val accent = Color.parseColor("#9880FF")

    /** The edge under an accent-filled element. */
    val accentEdge = Color.parseColor("#4228A8")

    /** An unfilled PIN dot. */
    val pinEmpty = Color.parseColor("#3A3560")
}
