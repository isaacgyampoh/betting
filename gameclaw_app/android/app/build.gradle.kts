import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/**
 * Release signing, read from android/key.properties - a file that is gitignored and never
 * committed. See docs/release-signing.md for how to create the keystore.
 *
 * Absent, `release` stays unsigned-by-upload-key and the build fails below rather than quietly
 * falling back to the debug key. A release APK signed with the debug key looks like a release,
 * installs like a release, and cannot be uploaded to Play - which is the kind of thing that is
 * discovered at the worst moment.
 */
/**
 * Firebase is optional, and applying its plugin without google-services.json fails the build.
 *
 * So the plugin is applied only when the file is there. A checkout with no Firebase configuration
 * still builds and runs - it simply has no push, which main.dart already handles. That is the
 * right trade: a missing optional feature must not stop the app being built at all.
 */
val googleServices = file("google-services.json")
if (googleServices.exists()) {
    apply(plugin = "com.google.gms.google-services")
}

val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasUploadKey = keystoreProperties.getProperty("storeFile") != null

/**
 * `-PunsignedRelease=true` builds a release-shaped APK with the debug key, for checking that
 * minification works before any production key exists.
 *
 * It had to exist because the guard below fires during `packageRelease`, which runs *after* R8 -
 * except that resource packaging fails first, so R8 had in fact never run at all. proguard-rules
 * .pro was written, committed, and never once exercised. The first time anyone would have learnt
 * whether those rules are complete is the day they created the upload key and tried to ship, with
 * a stripped class showing up as a crash in the field rather than as a build error.
 *
 * It cannot become an accidental release: Play rejects anything signed with the debug key.
 */
val unsignedRelease = (project.findProperty("unsignedRelease") as String?)?.toBoolean() == true

/** See the release build type below: R8 off, for isolating minification from signing. */
val noMinify = (project.findProperty("noMinify") as String?)?.toBoolean() == true

android {
    namespace = "win.gameclaw.app"
    // 37 rather than flutter.compileSdkVersion (36), because receive_sharing_intent 1.9.0
    // requires it and the share-sheet filter is useless without that plugin.
    //
    // compileSdk only decides which APIs the code may compile against; targetSdk, which is what
    // changes runtime behaviour, is left on Flutter's default. Android 37 is installed locally and
    // the release build is verified against it below.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications uses java.time, which minSdk 24 does not have. Desugaring
        // backports it rather than raising the floor and dropping older phones.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // Fixed for the lifetime of the app: Play Store listings are keyed on it and it cannot be
        // changed after the first upload.
        applicationId = "win.gameclaw.app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                // The keystore lives outside the repository; key.properties points at it.
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Only when a real upload key is configured. Without one the build fails at the check
            // below rather than producing something that looks shippable and is not.
            signingConfig = when {
                hasUploadKey -> signingConfigs.getByName("upload")
                // Verification only, and loudly announced below.
                unsignedRelease -> signingConfigs.getByName("debug")
                else -> null
            }
            // `-PnoMinify=true` builds a real, upload-signed release with R8 off.
            //
            // It exists to settle one question that otherwise cannot be answered: when something
            // works in debug and fails in release, the difference is the signing key *and*
            // minification, and those have to be separated before guessing at keep rules. Google
            // Sign-In is the case in point - it is reached reflectively through Credential
            // Manager, so a missing rule shows up as a configuration error rather than a crash.
            //
            // Diagnostic only. It is not a shipping configuration: an unminified release is
            // larger and keeps every symbol, which is exactly what minification is for.
            isMinifyEnabled = !noMinify
            isShrinkResources = !noMinify
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}

/**
 * A release build with no upload key is a mistake, and a silent one.
 *
 * Gradle would otherwise leave `release` unsigned or fall back to debug depending on the plugin
 * version, and either way the output is unusable on Play while looking exactly like a release
 * artifact. Failing here, with the instruction attached, costs a minute instead of a day.
 */
tasks.configureEach {
    if (name.contains("Release") && (name.startsWith("package") || name.startsWith("sign"))) {
        doFirst {
            if (!hasUploadKey && unsignedRelease) {
                logger.lifecycle(
                    "\n  This release APK is signed with the DEBUG key, because -PunsignedRelease" +
                        "=true.\n  It exists to check minification. Play will reject it. Do not " +
                        "distribute it.\n",
                )
            }
            if (!hasUploadKey && !unsignedRelease) {
                throw GradleException(
                    "\n\nRelease signing is not configured.\n" +
                        "  android/key.properties is missing, so this build has no upload key.\n" +
                        "  See docs/release-signing.md to create one.\n" +
                        "  Debug builds are unaffected: flutter build apk --debug\n" +
                        "  To check minification without a key: --android-project-arg=" +
                        "unsignedRelease=true\n",
                )
            }
        }
    }
}
