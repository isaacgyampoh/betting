allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Pin every module's Java and Kotlin targets to the same version.
//
// Without this the build fails on `:receive_sharing_intent:compileDebugKotlin`: that plugin
// declares Java 11 in its own Gradle file, while Kotlin picks up the JDK running Gradle - 21
// here - and the Kotlin plugin refuses the mismatch rather than producing class files two
// versions apart. It is the plugin's configuration, not ours, so it has to be corrected from
// the root where every subproject is reachable.
//
// 17 to match app/build.gradle.kts, which is the version the app itself is compiled at.
subprojects {
    plugins.withId("org.jetbrains.kotlin.android") {
        extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension> {
            compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
    // The Android extension, not the JavaCompile tasks: AGP reads `compileOptions` when it
    // configures them, so setting the tasks directly is overwritten and setting this is not.
    plugins.withId("com.android.library") {
        extensions.configure<com.android.build.api.dsl.LibraryExtension>("android") {
            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
        }
    }
}

// Make the app wait for the plugin modules' Kotlin.
//
// `firebase_core` and `receive_sharing_intent` still apply the Kotlin Gradle Plugin themselves
// rather than Flutter's built-in Kotlin, and AGP does not wire the app's javac to their Kotlin
// output. On a clean release build the app compiled first and failed with "cannot find symbol:
// class ReceiveSharingIntentPlugin" against the line Flutter generates in
// GeneratedPluginRegistrant.java. An incremental build hid it, because the classes were already
// on disk from a previous run.
//
// Removable once those plugins migrate to built-in Kotlin, which the build already warns about.
gradle.projectsEvaluated {
    val app = project(":app")
    subprojects.filter { it != app }.forEach { library ->
        listOf("Debug", "Release").forEach { variant ->
            val kotlin = library.tasks.findByName("compile${variant}Kotlin") ?: return@forEach
            app.tasks.findByName("compile${variant}JavaWithJavac")?.dependsOn(kotlin)
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
