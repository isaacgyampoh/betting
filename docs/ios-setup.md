# Bringing GameClaw to iPhone

Started 23 October 2026. The Flutter project was created Android-only, so there was no `ios/`
directory at all. This records what is now in place, what was measured rather than assumed, and
the things that cannot be done from here.

## What is done

| | |
|---|---|
| `ios/` platform directory | scaffolded with `flutter create --platforms=ios` |
| Bundle identifier | **`win.gameclaw.app`** — the template wrote `win.gameclaw.gameclawApp`; it must match the Android package because that is the identity Firebase and Google Sign-In are already registered against |
| Deployment target | **15.5**, not the template's 15.0 (see below) |
| `Info.plist` | display name `GameClaw`, photo-library usage string, `ITSAppUsesNonExemptEncryption=false` |
| Notifications | `lib/data/push.dart` is platform-aware: Darwin init settings, Darwin notification details, permission prompt still deferred |
| `.metadata` | lists **both** platforms; `flutter create` had replaced `android` with `ios` |

`flutter analyze` is clean and all 336 Flutter tests pass with the iOS project in the tree.

### Why 15.5

Read from the plugin, not from documentation:

```
google_mlkit_commons/ios/*.podspec      s.ios.deployment_target = '15.5'
google_mlkit_text_recognition/ios/*     s.ios.deployment_target = '15.5'
```

The Flutter template writes 15.0. CocoaPods refuses to install against a lower target than a pod
declares, so the first `pod install` would have failed with a message about the Runner target
being incompatible — a confusing first failure on a platform nobody has built yet.

### Every plugin already has an iOS implementation

Checked against the resolved dependency graph, not assumed. The umbrella packages for
`google_sign_in`, `image_picker`, `flutter_secure_storage`, `path_provider` and
`shared_preferences` carry no `ios/` directory because they are federated — the implementation
lives in `google_sign_in_ios`, `image_picker_ios`, `flutter_secure_storage_darwin`,
`path_provider_foundation` and `shared_preferences_foundation`, all of which are resolved for this
project. `firebase_core`, `firebase_messaging`, `flutter_local_notifications`, `share_plus`,
`receive_sharing_intent` and the ML Kit packages ship `ios/` directly.

There are **no** `Platform.is` branches anywhere in `lib/`, so no Dart code assumed Android other
than the notification setup, which is now handled.

## What cannot be done from this machine

Nothing below is a judgement call about the product; each is a tool, an account or a credential
that is not present.

| Blocker | What it costs | Needed for |
|---|---|---|
| **Xcode** | free, ~17 GB from the App Store, then `sudo xcode-select --switch` and `sudo xcodebuild -runFirstLaunch` | compiling anything for iOS |
| **CocoaPods** | free, needs `sudo gem install cocoapods` | installing the plugin pods |
| **Apple Developer Program** | **$99/year** | push notifications, a device build lasting more than 7 days, TestFlight, the App Store |
| **iOS OAuth client** | free, in Google Cloud | Google Sign-In; the reversed client id becomes a `CFBundleURLTypes` entry |
| **`GoogleService-Info.plist`** | free, in Firebase | Firebase on iOS |
| **APNs auth key (.p8)** | needs the paid account | FCM delivering to iPhones at all |

`flutter doctor` currently reports Xcode incomplete and CocoaPods missing, so `flutter build ios`
and the simulator are both unavailable. No iOS code here has been compiled, let alone run.

## Still to do once the toolchain exists

1. `pod install`, and fix whatever the first real build says. Nothing below has been compiled.
2. **Share extension.** `receive_sharing_intent` needs a second Xcode target plus an App Group for
   slips shared *into* GameClaw from a bookmaker's app. That is the Android feature with the
   largest iOS-side gap and it cannot be scaffolded from the command line.
3. **The alert sound.** `gameclaw_alert` is an Android raw resource. iOS needs a `.caf` in the app
   bundle, and `DarwinNotificationDetails` deliberately does **not** name one yet: naming a file
   that is not bundled makes iOS fall back to silence rather than to the default sound, and a
   silent alert reads as a broken one.
4. **Google Sign-In URL scheme** in `Info.plist`, once the iOS client exists.
5. **Icons and launch screen.** The template's placeholders are still in place.
6. Decide on iPad. The app is phone-shaped; the template enables iPad by default.

## What the website says

`lib/release.ts` carries `IOS_STATUS = "not-started"` and the site says iPhone is not built yet.
That stays true until something has actually run on a device — scaffolding a directory is not a
release, and the marketing page has one job here, which is to not promise a build that does not
exist.
