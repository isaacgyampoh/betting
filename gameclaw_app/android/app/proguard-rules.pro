# R8 rules for the release build.
#
# build.gradle.kts has referenced this file since minification was turned on, and it did not
# exist - so every release build failed on `Supplied proguard configuration does not exist`
# before it ever reached signing. Debug builds do not minify, which is why nothing noticed.
#
# Flutter's own engine rules ship with the engine and are applied automatically; these cover the
# plugins this app uses, which R8 cannot see through because they are reached by reflection or
# from native code rather than from Dart call sites it can trace.

# --- Flutter ----------------------------------------------------------------------------------
# The embedding is entered from native code, and deferred components by name.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.embedding.**

# --- Firebase Cloud Messaging ------------------------------------------------------------------
# FirebaseMessagingService and the installations/registrar classes are instantiated by the
# framework from the manifest, so nothing in our code refers to them.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# --- Google Sign-In ----------------------------------------------------------------------------
# Credential Manager and the sign-in client are reached through generated stubs.
-keep class com.google.android.libraries.identity.googleid.** { *; }
-dontwarn com.google.android.libraries.identity.googleid.**

# --- flutter_local_notifications ---------------------------------------------------------------
# Scheduled notifications are rebuilt after a reboot by deserialising a GSON blob, so the type
# information has to survive. Without this a reboot loses every scheduled alert, silently.
-keep class com.dexterous.** { *; }
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
-dontwarn com.dexterous.**

# --- sqlite3_flutter_libs / Drift ---------------------------------------------------------------
# The native library is loaded by name at runtime.
-keep class com.tekartik.sqflite.** { *; }
-dontwarn com.tekartik.sqflite.**

# --- flutter_secure_storage ----------------------------------------------------------------------
-keep class androidx.security.crypto.** { *; }
-dontwarn androidx.security.crypto.**

# --- Kotlin coroutines ----------------------------------------------------------------------------
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }

# --- Keep our own crash-report line numbers readable ---------------------------------------------
# Without SourceFile/LineNumberTable a stack trace from Play is a list of method names and nothing
# else. Renaming SourceFile to a constant keeps the obfuscation while leaving the lines usable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
