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

## Getting Xcode: three routes, all gated on the same thing

Tried in order, each diagnosed rather than assumed:

| Route | Result |
|---|---|
| App Store, driven by AppleScript | `osascript is not allowed assistive access (-1719)` — UI scripting needs osascript added to Privacy & Security → Accessibility, which is a security prompt only a person can answer |
| `developer.apple.com/download/all/` | HTTP **302** to `idmsa.apple.com/IDMSWebAuth/signin.html` — Apple ID wall |
| Any CLI installer (`mas`, `xcodes`) | needs Homebrew, which needs `sudo`, and an Apple ID either way |

Ruled out as causes, from Apple's own public lookup API rather than from guessing:

| | |
|---|---|
| Xcode | **27.1**, released 2026-10-15 |
| Minimum macOS | **26.6** — this Mac is 26.6.2, so it qualifies |
| Size | **3.1 GB**, free, present in the GH storefront |
| Disk free | 236 GB |

The App Store cache has stayed at **352 KB** and `storedownloadd` at **0.0% CPU** throughout, so
nothing was ever part-downloaded and nothing is wedged. It is one click plus an Apple ID.

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
2. **Share extension.** Sources are written and valid; the target is not, because creating one is
   an Xcode operation and faking it by hand-editing `project.pbxproj` is how a project file gets
   quietly corrupted.

   Ready in `ios/Share Extension/`:
   - `ShareViewController.swift` — subclasses `RSIShareViewController` and returns **true** from
     `shouldAutoRedirect()`. The plugin's example returns false, which shows a caption field and a
     Send button; that suits sharing a photo, not a booking code someone has just copied out of a
     bookmaker's app. Android hands the text straight to the app and so does this.
   - `Info.plist` — **text and one web URL only**. The example also accepts images, movies and
     files, which would put GameClaw in the share sheet for every photo on the phone and then
     leave it with nothing to say. This mirrors the Android filter, which is `text/plain` alone.
     The App Group is `$(CUSTOM_GROUP_ID)`, a build setting, so it is named in one place.

   In Xcode, once it exists: File → New → Target → Share Extension, named **Share Extension** so
   it picks these files up; set its deployment target to 15.5 to match Runner; add the plugin to
   the extension target via Swift Package Manager; add the App Group capability to both targets
   and set `CUSTOM_GROUP_ID`. **The App Group has to be registered on the Apple Developer
   account first** — it will not sign otherwise, which is why no identifier is hardcoded here.
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

## Audit of what else assumes Android

Checked rather than assumed, because "it is Flutter, it will just work" is how a platform launch
goes wrong quietly.

**No Supabase at runtime.** `pubspec.yaml` has no Supabase package; the only trace is a class
still *named* `SupabaseConfig`, which now holds either Supabase or GameClaw configuration.
`build-release.sh` passes `GC_AUTH_BASE`, so `isGameClaw` is true and the shipped build talks to
GameClaw's own API. The deleted project is not reachable from a correct build.

One real defect found there and fixed: the sign-in screen's "no sign-in configured" note said the
build was missing *"the Supabase flags"*. That stopped being true when auth moved, and it is a
message that sends whoever sees it hunting for credentials to a project that no longer exists.
Whoever meets it is building by hand rather than through the script - most likely on the first
`flutter run` from Xcode - so it now names `GC_AUTH_BASE` and points at the script.

**No deep links to port.** The Android manifest carries exactly two intent filters:
`MAIN`/`LAUNCHER`, and `ACTION_SEND` with `text/plain`. There is no custom URL scheme and no app
link, so there is no `apple-app-site-association` to host and no associated-domains entitlement to
add. The whole of the iOS sharing gap is the share extension.

**No `Platform.is` branches anywhere in `lib/`.** The only code that assumed Android was the
notification setup, which is handled.

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
