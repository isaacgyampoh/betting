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
flutter build appbundle --release \
  --dart-define=GC_API_BASE=https://gameclaw-api.nanagyams99.workers.dev/api/v1 \
  --dart-define=GC_SUPABASE_URL=... --dart-define=GC_SUPABASE_ANON_KEY=...
```

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
