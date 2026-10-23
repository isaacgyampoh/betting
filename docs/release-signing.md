# Android release signing

The app currently builds **debug** APKs. A release build needs an upload key, and this repository
deliberately contains none: a signing key in version control is a signing key anyone can use.

There is no existing production key for GameClaw — checked before writing this — so creating one
now overwrites nothing. If that ever changes, **do not generate a replacement**: an app already on
Play can only be updated by something signed with the key Google expects, and a new key means a
new listing.

## 1. Create the keystore (once, on your Mac)

Keep it **outside** the repository. `~/keys` is a reasonable home:

```bash
mkdir -p ~/keys
keytool -genkeypair -v \
  -keystore ~/keys/gameclaw-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload
```

`keytool` asks for a password and some identifying details. The password is yours; nothing in this
repository, and nothing in any build output, should ever contain it.

**Validity 10000 days** is deliberate — roughly 27 years. A key that expires during the app's life
is a problem with no good solution.

## 2. Point the build at it

```bash
cp gameclaw_app/android/key.properties.example gameclaw_app/android/key.properties
```

Then edit it: an **absolute** `storeFile` path, the password you just chose, and `keyAlias=upload`.

`android/key.properties`, `*.jks` and `*.keystore` are all gitignored. Check before committing:

```bash
git check-ignore -v gameclaw_app/android/key.properties
```

## 3. Build

```bash
cd gameclaw_app
./build-release.sh            # APK, for installing on a device
./build-release.sh appbundle  # AAB, for uploading to Play
```

Use the script rather than calling `flutter build` directly. The `--dart-define`s are not optional
and their absence is **silent**: without `GC_API_BASE` the app falls back to
`http://10.0.2.2:3000/api/v1`, the emulator's route to a developer's laptop, and the result signs,
installs and launches perfectly while every screen reports "Something went wrong". Without
`GC_AUTH_BASE` sign-in falls back to Supabase, whose project no longer exists.

The command this replaced pointed `GC_API_BASE` at `gameclaw-api.nanagyams99.workers.dev`, which
was retired when the API moved to Render, and passed the two Supabase defines instead of
`GC_AUTH_BASE` and `GC_GOOGLE_SERVER_CLIENT_ID`. Following it produced a build that could reach
neither the API nor sign-in.

Without `key.properties` the release build **fails with an explanation**. That is on purpose.
Gradle's own behaviour is to fall back to the debug key, which produces something that looks like
a release, installs like a release, and is rejected by Play — discovered at the worst moment.

Debug builds are unaffected and need none of this.

### Checking minification without a key

```bash
flutter build apk --release --android-project-arg=unsignedRelease=true
```

Signs with the **debug** key and says so, loudly, twice. It exists because the guard above fires
during packaging, which happens after R8 — except that resource packaging failed first, so R8 had
never actually run and `proguard-rules.pro` had never been exercised at all. A missing keep rule
would have surfaced as a crash in somebody's hands rather than as a build error.

Play rejects anything signed with the debug key, so this cannot turn into a release by accident.

Verified 2026-10-17: R8 completes, the 63MB APK installs, and the minified build loads live
scores, opens a match and reaches Google's account chooser without a stripped class.

## 4. Back it up

Losing this file means losing the ability to update the app under its current listing.

- Copy `~/keys/gameclaw-upload.jks` somewhere durable and private — an encrypted drive, or a
  password manager that takes file attachments.
- Store the password **separately** from the keystore.
- Do not put either in the repository, in a chat, or in a cloud folder that syncs to shared
  devices.

Enrolling in Play App Signing when you first upload is worth doing: Google then holds the real
signing key and this one becomes an *upload* key, which can be reset if lost. Without it, this
file is irreplaceable.

## 5. Register the release fingerprint with Google, or nobody can sign in

**This is the step that will otherwise break the launch, and it will break it silently.**

Google sign-in is the only way into GameClaw. Google decides whether a caller really is GameClaw
by matching the app's package name and **signing certificate fingerprint** against an Android
OAuth client. The debug key and the release key have different fingerprints. So sign-in working
on a debug build on your desk says nothing at all about whether it works for a real user who
installed from Play — that build is signed with a different key, and Google will refuse it.

With Play App Signing enabled there are *two* fingerprints that matter, and both need a client:

| Fingerprint | Where to find it | Needed because |
|---|---|---|
| Upload key SHA-1 | `keytool -list -v -keystore ~/keys/gameclaw-upload.jks -alias upload` | internal testing tracks, and any APK you sideload |
| **App signing key SHA-1** | Play Console → your app → Test and release → **App integrity** → App signing key certificate | this is what Google re-signs with, and what every installed copy actually carries |

In Google Cloud Console → *APIs & Services* → *Credentials*, create an **Android** OAuth client
for each, package name `win.gameclaw.app`. They are free and there is no limit worth worrying
about; having all three (debug, upload, app-signing) registered is normal.

The failure mode if you skip it: the account chooser appears, the user picks an account, and the
app reports `[16] Account reauth failed`. It looks like the user's fault. It is not.

### Telling that failure apart from any other

`[16] Account reauth failed` is what the plugin surfaces, and it is not specific enough to act
on. The real message is in Play Services' own log, and it names the problem exactly:

```bash
adb logcat -c
# ...drive the sign-in on the device...
adb logcat -d | grep -iE "GetTokenResponseHandler|UNREGISTERED_ON_API_CONSOLE"
```

Checked on the Pixel, 2026-10-17:

> `Server returned error: This android application is not registered to use OAuth2.0, please
> confirm the package name and SHA-1 certificate fingerprint match what you registered in Google
> Developer Console.`
>
> `cvtf: [8] Unknown error [status=UNREGISTERED_ON_API_CONSOLE].`

`UNREGISTERED_ON_API_CONSOLE` means exactly one thing: Google has no Android OAuth client for
this package name and this signing fingerprint. It is not a token problem, not an audience
problem and not a Supabase or Render problem - the request never gets that far.

Confirm the fingerprint Google is actually seeing, rather than the one you think it is, by
reading it off the APK on the phone:

```bash
adb pull "$(adb shell pm path win.gameclaw.app | head -1 | tr -d '\r' | sed 's/package://')" /tmp/installed.apk
"$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs /tmp/installed.apk | grep SHA-1
```

On 2026-10-17 that returned `1b33669cb0801a8550897686e4b75312d38e74ec`, which is the debug
keystore's fingerprint - so the fingerprint was right and the client was simply absent.

### Finding out what a client id actually is, without console access

Google's own authorization endpoint will tell you, and it needs no credentials. Ask for an
authorization it will refuse, and read *how* it refuses:

```bash
curl -sL "https://accounts.google.com/o/oauth2/v2/auth\
?client_id=<ID>.apps.googleusercontent.com\
&redirect_uri=https%3A%2F%2Fexample.com&response_type=code&scope=openid"
```

| What comes back | What it means |
|---|---|
| `Error 401: invalid_client` — "OAuth client was not found" | no such client |
| `Error 401: deleted_client` — "OAuth client was deleted" | it existed and is gone |
| `Error 400: redirect_uri_mismatch` | the client **exists**; this redirect is not registered on it |

To tell an Android client from a Web one, ask again with that client's own custom scheme as the
redirect: `com.googleusercontent.apps.<ID>:/oauth2redirect`. An Android client makes Google name
the package in the refusal — "**win.gameclaw.app**'s request is invalid" — where a Web client
shows the project's consent-screen name instead.

### What this turned up on 2026-10-17

| Client id | Google's verdict |
|---|---|
| `400646694915-k5ikq1…` — **compiled into every build so far** | `deleted_client` |
| `400646694915-uso8a1…` | exists, and names `win.gameclaw.app` — the **Android** client |

So the Web client had been **deleted**, and what replaced it was an Android client. That is two
different failures in sequence, which is why fixing the first did not fix the sign-in:

1. No Android client → `UNREGISTERED_ON_API_CONSOLE`, before any consent screen.
2. Android client present, Web client deleted → consent screen appears, then
   **`[28444] Developer console is not set up correctly`**.

### And again on 2026-10-18, after the release key existed

Two faults stacked, and the first masked the second.

The release build was signed with the new upload key, whose SHA-1 is registered nowhere, so Google
refused before any server call: **`[16] Account reauth failed`**. Underneath that, the build had
been compiled with `400646694915-uso8a1…` as `serverClientId` - the **Android** client this
document had already identified a day earlier. Fixing only the fingerprint would have produced an
audience mismatch at our own server instead.

The probe below no longer needs interpreting: Google now returns the client type in as many words,
base64 inside the `authError` parameter of the redirect.

```bash
curl -s -i -G "https://accounts.google.com/o/oauth2/v2/auth" \
  --data-urlencode "client_id=<ID>.apps.googleusercontent.com" \
  --data-urlencode "response_type=code" --data-urlencode "scope=openid" \
  --data-urlencode "redirect_uri=com.googleusercontent.apps.<ID>:/oauth2redirect" \
  | grep -oE 'authError=[A-Za-z0-9_-]+' | cut -d= -f2 | base64 -d
```

| Client id | Decoded verdict |
|---|---|
| `400646694915-uso8a1…` | "Custom URI scheme is not enabled for your **Android** client" |
| `400646694915-b4oh5at…` | "Custom scheme URIs are not allowed for **'WEB'** client type" |
| `400646694915-g6t2757…` | "Custom scheme URIs are not allowed for **'WEB'** client type" |

Both Web clients are in `GOOGLE_WEB_CLIENT_ID` on Render, so either works as `serverClientId`.
Builds now use `b4oh5at…`.

**An Android OAuth client holds one package and one SHA-1.** A second fingerprint needs a second
client, not an edit to the first - so the debug key keeps its own client and the release key gets
another. Play App Signing will add a third, because Google re-signs the upload with its own key.

`serverClientId` must be a **Web** client - it is the audience the ID token is addressed to, and
an Android client cannot serve as one. Both must exist: the Android client is how Google decides
the caller is really this app; the Web client is who the token is for.

## 19 Oct — proving which variable caused `[28444]`

Sign-in worked on debug and failed on release with `[28444] Developer console is not set up
correctly`. Three things differed between those builds — the signing key, R8, and (unknown at the
time) the package name the OAuth client was registered against. The error names none of them.

Each was isolated rather than guessed at:

| Variable | How it was isolated | Result |
| --- | --- | --- |
| R8 | `-PnoMinify=true`, a real upload-signed release with minification off | Failed identically. Not the cause. |
| OAuth client reachability | `GET accounts.google.com/o/oauth2/v2/auth` per client id, with a fabricated id as a control | All clients live; control correctly reported missing. Not propagation. |
| Signing certificate | APK pulled back off the device with `adb pull`, `apksigner verify --print-certs` | `c9b519…`, matching what was registered. Not the key. |
| Package name | `-PdiagPkg=win.gameclaw.app2`, same key, same audience, installed **beside** the real app | **Signed in successfully.** |

The last row is the answer. `win.gameclaw.app2` and `win.gameclaw.app` differed in nothing except
which package name the Android OAuth client carried, so the registration was the only broken part.

Two things made this cheap, and both are worth repeating:

- A package-name override installs as a *second* app. Nothing had to be uninstalled and no user
  data was touched, which an experiment on the signing key would have required.
- `applicationIdSuffix` is joined with a dot and produces `win.gameclaw.app.2`. An override of
  `applicationId` is what gives the exact string.

Reproduce by adding, temporarily, to `android/app/build.gradle.kts`:

```kotlin
val diagPkg = project.findProperty("diagPkg") as String?
// in defaultConfig:
applicationId = diagPkg ?: "win.gameclaw.app"
```

`google-services.json` needs a client block whose `package_name` matches, or the Google Services
plugin fails the build. Revert both afterwards; neither belongs in a release build.

Beware one false positive when grepping logcat for the error code: `ParceledListSlice: Element #97
is 28444 bytes` is a byte count, not a status. Match on `Auth.Api.Credentials` instead.


## 21 Oct — what the Firebase CLI could and could not settle

With an authenticated `firebase` session, three things became facts rather than hypotheses.

**`game-claw` (400646694915) has no Firebase apps at all** — no Android, no Web. Every OAuth client
in it (`uso8a1k`, `b4oh5at`, `k5ikq1qt`, `r59d0h59`) was created directly in Cloud Console, which
is why nothing in the Firebase API can edit them.

**`gameclaw-push-notifications` (569032239509) holds the Android app for `win.gameclaw.app`, and it
has zero SHA certificates and zero `oauth_client` entries.**

```
$ firebase apps:android:sha:list 1:569032239509:android:d73db0f4968de8601a2e9c
No SHA certificate hashes found.
```

That **corrects earlier advice in this repository.** The guidance was to remove the release
fingerprint from the Firebase app before re-saving the client, on the theory that Firebase was
holding it. Firebase is holding nothing. There is nothing to remove there, and following that
advice would have been time spent on an empty list.

**Creating the Android app in `game-claw` reproduces the Console error through a supported API:**

```
POST firebase.googleapis.com/v1beta1/projects/game-claw/androidApps
     {"packageName":"win.gameclaw.app"}
  -> 409 {"error":{"status":"ALREADY_EXISTS"}}
```

So `win.gameclaw.app` is already claimed inside `game-claw`, while `apps:list` shows no app there.
The only things in that project claiming a package name are the Cloud Console OAuth clients, and
`uso8a1k` is registered to `win.gameclaw.app` with the **debug** fingerprint.

### What is left, and why no API reaches it

Google publishes no API for creating or editing OAuth 2.0 client IDs; the Firebase Management API
covers Firebase apps and their SHA certificates, which is a different resource. An Android client
binds one package to one fingerprint, so the release key needs its own client alongside the debug
one.

The action is therefore in Cloud Console, and it is better done as a **create** than as an edit of
`r59d0h59`: a new Android client for `win.gameclaw.app` + `C9:B5:19:…:13:75` leaves the diagnostic
client untouched and fails loudly if that exact pair really is taken somewhere, which is the one
thing still unestablished.
