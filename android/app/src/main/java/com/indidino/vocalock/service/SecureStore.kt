package com.indidino.vocalock.service

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Backup PIN storage (spec section 4.8). The raw PIN is never written anywhere
 * and never leaves the device — only a salted PBKDF2 hash, inside
 * EncryptedSharedPreferences.
 */
object SecureStore {

    private const val FILE = "vocalock_secure"
    private const val KEY_SALT = "pinSalt"
    private const val KEY_HASH = "pinHash"
    private const val KEY_LENGTH = "pinLength"

    private const val ITERATIONS = 120_000
    private const val KEY_LENGTH_BITS = 256
    private const val SALT_BYTES = 16

    private fun prefs(context: Context): SharedPreferences {
        val app = context.applicationContext
        val masterKey = MasterKey.Builder(app)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            app,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun setPin(context: Context, pin: String) {
        val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
        prefs(context).edit()
            .putString(KEY_SALT, salt.encode())
            .putString(KEY_HASH, hash(pin, salt).encode())
            // Length only, never the digits: the PIN pad needs to know when the
            // entry is complete so it does not burn an attempt per keystroke.
            .putInt(KEY_LENGTH, pin.length)
            .apply()
    }

    fun hasPin(context: Context): Boolean =
        prefs(context).getString(KEY_HASH, null) != null

    /** 0 when no PIN is set. */
    fun pinLength(context: Context): Int = prefs(context).getInt(KEY_LENGTH, 0)

    fun verifyPin(context: Context, pin: String): Boolean {
        val p = prefs(context)
        val salt = p.getString(KEY_SALT, null)?.decode() ?: return false
        val stored = p.getString(KEY_HASH, null)?.decode() ?: return false
        return stored.constantTimeEquals(hash(pin, salt))
    }

    fun clearPin(context: Context) {
        prefs(context).edit().remove(KEY_SALT).remove(KEY_HASH).remove(KEY_LENGTH).apply()
    }

    private fun hash(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, KEY_LENGTH_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    /** Length-independent compare so a wrong PIN cannot be timed out of us. */
    private fun ByteArray.constantTimeEquals(other: ByteArray): Boolean {
        var diff = size xor other.size
        for (i in indices) diff = diff or (this[i].toInt() xor other[i % other.size].toInt())
        return diff == 0
    }

    private fun ByteArray.encode(): String = Base64.encodeToString(this, Base64.NO_WRAP)
    private fun String.decode(): ByteArray = Base64.decode(this, Base64.NO_WRAP)
}
