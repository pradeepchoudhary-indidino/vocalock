package com.indidino.vocalock.service

import android.content.Context
import android.util.Log
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * Owns the Vosk acoustic models: unpacks one from assets on first use and keeps
 * it loaded.
 *
 * Separate from PhraseSpotter because a Model costs tens of megabytes of RAM and
 * several seconds to load, while a Recognizer built from it is cheap. Setup's
 * phrase check and the always-on spotter therefore share one Model rather than
 * loading a second copy.
 */
object VoskModels {

    private const val TAG = "VoskModels"

    /** Language tag -> (asset zip, unpack directory). */
    private val ASSETS = mapOf(
        "en" to ("vosk-model-en-in.zip" to "vosk-model-en"),
        "hi" to ("vosk-model-hi.zip" to "vosk-model-hi"),
    )

    private const val READY_MARKER = ".unpacked"

    /**
     * Directory used before the app supported more than one language. Left
     * behind on upgrade it wastes ~54 MB of the user's storage forever.
     */
    private const val LEGACY_DIR = "vosk-model"

    private val lock = Any()
    private val loaded = mutableMapOf<String, Model>()

    val supportedLanguages: Set<String> get() = ASSETS.keys

    fun normalizeLanguage(language: String?): String =
        language?.lowercase()?.take(2)?.takeIf { ASSETS.containsKey(it) } ?: "en"

    /**
     * Unpacks if needed and returns the model. Slow on first call for a
     * language — call from a background thread.
     */
    fun model(context: Context, language: String): Model {
        val lang = normalizeLanguage(language)
        synchronized(lock) {
            loaded[lang]?.let { return it }
        }

        // Vosk reports grammar problems — above all words missing from the
        // model's vocabulary — through Kaldi's logger. Without this they go
        // nowhere, and a phrase the model cannot hear looks exactly like one it
        // can. That is precisely how an unspottable phrase got saved once.
        runCatching { LibVosk.setLogLevel(LogLevel.INFO) }

        val app = context.applicationContext
        removeLegacyModel(app)
        val dir = ensureUnpacked(app, lang)
        val model = Model(dir.absolutePath)
        synchronized(lock) {
            // Another thread may have won the race; keep whichever is stored.
            loaded[lang]?.let {
                model.close()
                return it
            }
            loaded[lang] = model
            return model
        }
    }

    fun releaseAll() {
        synchronized(lock) {
            loaded.values.forEach { runCatching { it.close() } }
            loaded.clear()
        }
    }

    private fun removeLegacyModel(context: Context) {
        val legacy = File(context.filesDir, LEGACY_DIR)
        if (!legacy.exists()) return
        Log.i(TAG, "removing pre-multilingual model directory")
        runCatching { legacy.deleteRecursively() }
    }

    private fun ensureUnpacked(context: Context, language: String): File {
        val (asset, dirName) = ASSETS.getValue(language)
        val target = File(context.filesDir, dirName)
        val marker = File(target, READY_MARKER)
        if (marker.exists()) return target

        Log.i(TAG, "unpacking $asset for '$language'")
        if (target.exists()) target.deleteRecursively()
        target.mkdirs()

        context.assets.open(asset).use { raw ->
            ZipInputStream(raw.buffered()).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    // The archives have a single top-level folder; drop it so
                    // the model files land directly in `target`.
                    val relative = entry.name.substringAfter('/', "")
                    if (relative.isNotEmpty()) {
                        val out = File(target, relative)
                        if (!out.canonicalPath.startsWith(target.canonicalPath)) {
                            throw SecurityException("zip entry escapes target: ${entry.name}")
                        }
                        if (entry.isDirectory) {
                            out.mkdirs()
                        } else {
                            out.parentFile?.mkdirs()
                            FileOutputStream(out).use { zip.copyTo(it) }
                        }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
        }

        marker.createNewFile()
        return target
    }
}
