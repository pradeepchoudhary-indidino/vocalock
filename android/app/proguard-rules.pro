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

# --- Capacitor core --------------------------------------------------------
# Capacitor's consumer rules keep the plugins but not the bridge that reads
# their annotations reflectively. In 1.2 R8 deleted PluginHandle's
# pluginAnnotation field outright, so getPermissionState() hit a null
# annotation and every launch crashed (Play rejection, 14 Oct 2026). Keep the
# whole core and the annotations it reads at runtime.
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault
-keep class com.getcapacitor.** { *; }
-keep @interface com.getcapacitor.** { *; }

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

# --- Social login: Facebook off -------------------------------------------
# capacitor.config.ts turns the Facebook provider off, so its SDK is
# compileOnly and absent from the APK (keeping out its AD_ID permission). The
# plugin's FacebookProvider still references it but is never initialised.
-dontwarn com.facebook.**

# --- Razorpay Checkout (RazorpayPlugin) ---------------------------------------
# From Razorpay's Android integration guide. Checkout talks to its page through
# @JavascriptInterface methods and calls back onPayment* on MainActivity by
# name, so neither may be renamed or stripped.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** {*;}
-optimizations !method/inlining/*
-keepclasseswithmembers class * {
  public void onPayment*(...);
}
