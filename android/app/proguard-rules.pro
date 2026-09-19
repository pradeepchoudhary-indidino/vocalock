# Capacitor ships its own consumer rules, so plugins and @PluginMethod are
# already covered. What is not covered is anything bound natively by NAME —
# R8 renames and removes on the assumption that Java call sites are the only
# call sites, which is false for JNA.

# --- JNA -------------------------------------------------------------------
# Every JNA binding is resolved reflectively from the class and method names,
# so none of them may be renamed or stripped.
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.Library { *; }
-keep class * extends com.sun.jna.Structure { *; }
-keep class * extends com.sun.jna.PointerType { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
# JNA carries desktop-JVM code paths that never run on Android.
-dontwarn com.sun.jna.**
-dontwarn java.awt.**

# --- Vosk ------------------------------------------------------------------
# LibVosk does Native.register(LibVosk.class, "vosk"): the native symbols in
# libvosk.so are matched against these method names at runtime.
-keep class org.vosk.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# --- Our own bridge --------------------------------------------------------
# Plugin methods are invoked from JavaScript by name; the Capacitor rules cover
# the annotated ones, this covers the classes themselves.
-keep class com.indidino.vocalock.plugins.** { *; }

# Kept for the stack traces to be worth anything when a user reports a crash.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- Tink (via androidx.security-crypto, which backs SecureStore) -----------
# Tink is annotated with ErrorProne and JSR-305 annotations that exist only at
# compile time. They are absent at runtime by design, so the references are
# harmless — R8 just needs telling.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**
