package com.indidino.vocalock.service

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread

/**
 * Owns the Vosk acoustic models: downloads the one a language needs, unpacks
 * it, and keeps it loaded.
 *
 * The models used to ship inside the APK — 81 of its 87 MB, with every user
 * carrying both languages and a second, zipped copy of the one they used. Now
 * each is fetched once, from our own server, when setup first needs it; the zip
 * is deleted after unpacking. Recognition itself stays fully offline.
 *
 * Separate from PhraseSpotter because a Model costs tens of megabytes of RAM and
 * several seconds to load, while a Recognizer built from it is cheap. Setup's
 * phrase check and the always-on spotter therefore share one Model rather than
 * loading a second copy.
 */
object VoskModels {

    private const val TAG = "VoskModels"

    private const val BASE_URL = "https://vocalock.indidino.com/models/"

    /**
     * One downloadable model. The checksum is of the published zip; a model that
     * does not match is thrown away rather than handed to native code.
     */
    private class Spec(val file: String, val bytes: Long, val sha256: String, val dir: String)

    private val MODELS = mapOf(
        "en" to Spec(
            file = "vosk-model-small-en-in-0.4.zip",
            bytes = 37_573_330L,
            sha256 = "20663dcac4d5cb783a579c54d98339344a688e4ec6e1b4a4b059fd1235454cc7",
            dir = "vosk-model-en",
        ),
        "hi" to Spec(
            file = "vosk-model-small-hi-0.22.zip",
            bytes = 44_458_845L,
            sha256 = "7c50a10866889f0ac21d912c20537a055a597ed09fc1d3e5bcd798f9f0017e48",
            dir = "vosk-model-hi",
        ),
    )

    private const val READY_MARKER = ".unpacked"

    /**
     * Directory used before the app supported more than one language. Left
     * behind on upgrade it wastes ~54 MB of the user's storage forever.
     */
    private const val LEGACY_DIR = "vosk-model"

    /** A flaky mobile connection gets this many tries, resuming each time. */
    private const val MAX_ATTEMPTS = 4

    /** Zip plus unpacked model plus headroom; the model unpacks to ~1.9x. */
    private const val SPACE_FACTOR = 3.2

    enum class State { MISSING, DOWNLOADING, READY, FAILED }

    /** Thrown by [model] when the language has not been downloaded yet. */
    class NotInstalled(language: String) : IllegalStateException("model for '$language' not downloaded")

    private val lock = Any()
    private val loaded = mutableMapOf<String, Model>()

    /** Per language, guarded by [lock]. */
    private val downloading = mutableSetOf<String>()
    private val progress = mutableMapOf<String, Long>()
    private val failures = mutableMapOf<String, String>()

    private val installedListeners = CopyOnWriteArrayList<(String) -> Unit>()

    val supportedLanguages: Set<String> get() = MODELS.keys

    fun normalizeLanguage(language: String?): String =
        language?.lowercase()?.take(2)?.takeIf { MODELS.containsKey(it) } ?: "en"

    fun isInstalled(context: Context, language: String): Boolean {
        val spec = MODELS.getValue(normalizeLanguage(language))
        return File(File(context.applicationContext.filesDir, spec.dir), READY_MARKER).exists()
    }

    /** Called with the language once a download has been unpacked. */
    fun addInstalledListener(listener: (String) -> Unit) {
        installedListeners += listener
    }

    fun removeInstalledListener(listener: (String) -> Unit) {
        installedListeners -= listener
    }

    /**
     * What the UI shows: state, bytes so far, total. Also emitted as the
     * `modelState` event on every change.
     */
    fun state(context: Context, language: String): JSONObject {
        val lang = normalizeLanguage(language)
        val spec = MODELS.getValue(lang)
        val state = synchronized(lock) {
            when {
                isInstalled(context, lang) -> State.READY
                lang in downloading -> State.DOWNLOADING
                failures.containsKey(lang) -> State.FAILED
                else -> State.MISSING
            }
        }
        val done = if (state == State.READY) {
            spec.bytes
        } else {
            synchronized(lock) { progress[lang] } ?: partFile(context, spec).length()
        }
        return JSONObject()
            .put("language", lang)
            .put("state", state.name.lowercase())
            .put("downloadedBytes", done)
            .put("totalBytes", spec.bytes)
            .apply { synchronized(lock) { failures[lang] }?.let { put("error", it) } }
    }

    /**
     * Starts fetching the model unless it is installed or already on its way.
     * Returns at once; follow it through [state] or the `modelState` event.
     */
    fun prepare(context: Context, language: String) {
        val app = context.applicationContext
        val lang = normalizeLanguage(language)
        if (isInstalled(app, lang)) return
        synchronized(lock) {
            if (!downloading.add(lang)) return
            failures.remove(lang)
        }
        emitState(app, lang)
        thread(name = "vocalock-model-$lang", isDaemon = true) {
            val spec = MODELS.getValue(lang)
            val startedAt = System.currentTimeMillis()
            val resumedFrom = partFile(app, spec).length()
            NativeEvents.record(
                app,
                "model_download_started",
                JSONObject().put("language", lang).put("resumed_from", resumedFrom),
            )
            val outcome = runCatching { install(app, lang, spec) }
            NativeEvents.record(
                app,
                if (outcome.isSuccess) "model_download_done" else "model_download_failed",
                JSONObject()
                    .put("language", lang)
                    .put("ms", System.currentTimeMillis() - startedAt)
                    .put("resumed_from", resumedFrom)
                    .apply { outcome.exceptionOrNull()?.let { put("error", describe(it)) } },
            )
            synchronized(lock) {
                downloading.remove(lang)
                progress.remove(lang)
                outcome.exceptionOrNull()?.let { failures[lang] = describe(it) }
            }
            outcome.exceptionOrNull()?.let { Log.w(TAG, "model download for '$lang' failed", it) }
            emitState(app, lang)
            if (outcome.isSuccess) installedListeners.forEach { runCatching { it(lang) } }
        }
    }

    /**
     * Returns the loaded model. Slow on first call for a language — call from a
     * background thread. Throws [NotInstalled], and starts the download, when
     * the language has not been fetched yet.
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
        if (!isInstalled(app, lang)) {
            prepare(app, lang)
            throw NotInstalled(lang)
        }
        val model = Model(File(app.filesDir, MODELS.getValue(lang).dir).absolutePath)
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

    // ----- download -----

    /** Not backed up: it is a cache of a public file, and tens of megabytes. */
    private fun partFile(context: Context, spec: Spec) =
        File(context.noBackupFilesDir, "${spec.file}.part")

    private fun install(context: Context, lang: String, spec: Spec) {
        val part = partFile(context, spec)
        val needed = (spec.bytes * SPACE_FACTOR).toLong() - part.length()
        if (context.filesDir.usableSpace < needed) {
            throw IOException("not enough storage")
        }

        var attempt = 0
        while (part.length() < spec.bytes) {
            try {
                fetch(context, lang, spec, part)
            } catch (e: IOException) {
                if (++attempt >= MAX_ATTEMPTS) throw e
                Log.i(TAG, "download for '$lang' interrupted, retrying (${e.message})")
                Thread.sleep(2_000L * attempt)
            }
        }

        if (part.length() != spec.bytes || sha256(part) != spec.sha256) {
            part.delete()
            throw IOException("download was corrupted")
        }
        unpack(part, File(context.filesDir, spec.dir))
        part.delete()
        Log.i(TAG, "model for '$lang' installed")
    }

    /** One HTTP request, resuming from whatever is already in [part]. */
    private fun fetch(context: Context, lang: String, spec: Spec, part: File) {
        val connection = (URL(BASE_URL + spec.file).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            if (part.length() > 0) setRequestProperty("Range", "bytes=${part.length()}-")
        }
        try {
            val append = when (connection.responseCode) {
                HttpURLConnection.HTTP_PARTIAL -> true
                // The server ignored the range: start over rather than append
                // the whole file onto a partial one.
                HttpURLConnection.HTTP_OK -> false
                else -> throw IOException("server answered ${connection.responseCode}")
            }
            var done = if (append) part.length() else 0L
            var lastEmit = 0L
            connection.inputStream.use { input ->
                FileOutputStream(part, append).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        done += n
                        if (done > spec.bytes) throw IOException("download is larger than expected")
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 250) {
                            lastEmit = now
                            synchronized(lock) { progress[lang] = done }
                            emitState(context, lang)
                        }
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Unpacks into a scratch directory and renames it into place, so a crash
     * halfway leaves no directory that looks complete.
     */
    private fun unpack(zipFile: File, target: File) {
        val scratch = File(target.parentFile, "${target.name}.tmp")
        scratch.deleteRecursively()
        scratch.mkdirs()

        ZipInputStream(FileInputStream(zipFile).buffered()).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                // The archives have a single top-level folder; drop it so
                // the model files land directly in the model directory.
                val relative = entry.name.substringAfter('/', "")
                if (relative.isNotEmpty()) {
                    val out = File(scratch, relative)
                    if (!out.canonicalPath.startsWith(scratch.canonicalPath)) {
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

        File(scratch, READY_MARKER).createNewFile()
        target.deleteRecursively()
        if (!scratch.renameTo(target)) {
            scratch.deleteRecursively()
            throw IOException("could not move the model into place")
        }
    }

    private fun describe(error: Throwable): String = when {
        error.message == "not enough storage" -> "storage"
        error.message == "download was corrupted" -> "failed"
        // Dropped connections, timeouts, no signal: worth a retry later.
        error is IOException -> "network"
        else -> "failed"
    }

    private fun emitState(context: Context, lang: String) {
        ListenerBus.emit("modelState", state(context, lang))
    }
}
