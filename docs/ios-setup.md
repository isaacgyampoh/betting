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
| App icon | all 15 sizes rendered from the same mark the Play listing uses, by `scripts/ios-appicon.swift` |
| Alert sound | `ios/Runner/gameclaw_alert.caf`, converted from the Android `.wav`, listed in the Xcode Resources phase |
| APNs payload | `lib/services/fcm.ts` now sends an `apns` block; without it iOS used the default sound |
| `Podfile` | written from Flutter's own template, platform pinned to 15.5 |
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
3. ~~The alert sound.~~ **Done.** `afconvert` produced `ios/Runner/gameclaw_alert.caf` from the
   Android `.wav` (48 kHz mono Int16, 0.67 s - well inside the 30 s iOS allows), and it is listed
   in the Runner target's Resources build phase so it is copied into the bundle. iOS reads a
   notification sound from the app bundle, not from Flutter's assets, which is why it is in the
   Xcode project rather than `pubspec.yaml`.

   The server needed the other half: `lib/services/fcm.ts` sent an `android` block and nothing
   else, and iOS ignores all of it. A backgrounded alert would have used the system default while
   the same alert in the foreground played ours - the app sounding different depending on whether
   it happened to be open, which reads as a bug rather than a setting. It now sends an `apns`
   block naming `gameclaw_alert.caf` (with the extension, unlike Android's resource name) and an
   `apns-collapse-id` so a goal confirmed twice replaces its own notification.

   **Not verified.** Remote push on iOS needs APNs credentials this account does not have. Local
   notification code is in place; nothing has been delivered to an iPhone.
4. **Google Sign-In URL scheme** in `Info.plist`, once the iOS client exists.
5. **Launch screen.** The template's placeholder is still in place. The app icon is done:
   `scripts/ios-appicon.swift` renders all 15 sizes from the same geometry as the advertisement
   and the Play listing, opaque and unrounded because iOS applies its own mask and rejects an icon
   that ships with alpha. It is drawn at 4x and downsampled - three tapered curves render as
   stair-steps at 20pt otherwise - and flipped in y, because CoreGraphics' bottom-left origin
   renders the mark mirrored and the icon has to be the same drawing as `play-assets/icon-512.png`,
   not a reflection of it.
6. Decide on iPad. The app is phone-shaped; the template enables iPad by default.

## Apple's rules are not Google's

Read from the current App Review Guidelines, quoted rather than recalled.

**5.3.4** — "Apps that offer real money gaming (such as sports betting, poker, casino games, horse
racing) or lotteries must have necessary licensing and permissions in the locations where the app
is used, must be geo-restricted to those locations, and must be free on the App Store. Illegal
gambling aids, including card counters, are not permitted on the App Store."

The trigger is **"offer real money gaming"**, which is narrower than Google's "enable or facilitate
users' ability to wager". GameClaw offers no gaming, takes no stake and holds no money, so on its
face 5.3.4 is not engaged the way the Play prohibition is. "Illegal gambling aids" is the phrase to
watch, and the aid here is to a slip at a licensed bookmaker, not to an illegal one.

**5.1.1(ix)** — "Apps that provide services in highly regulated fields (such as banking and
financial services, healthcare, gambling, legal cannabis use, air travel and crypto exchanges) or
that require sensitive user information should be submitted by a legal entity that provides the
services, and not by an individual developer."

**This is the harder one, and it is a different problem from Play's.** It is about *who submits*,
not what the app does. An individual developer account may be refused for a gambling-adjacent app
whatever the app's functionality, and no change to the product fixes that - it needs a company and
an Apple Developer Program enrolment as an organisation, which requires a D-U-N-S number.

So the two stores are uncertain for unrelated reasons: Play over whether conversion is
"facilitating", Apple over whether an individual may publish in this field at all. Neither has been
put to its review team. Nothing here says either will approve.

## What the website says

`lib/release.ts` carries `IOS_STATUS = "not-started"` and the site says iPhone is not built yet.
That stays true until something has actually run on a device — scaffolding a directory is not a
release, and the marketing page has one job here, which is to not promise a build that does not
exist.
