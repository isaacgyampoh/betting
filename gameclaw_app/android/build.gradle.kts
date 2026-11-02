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

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
