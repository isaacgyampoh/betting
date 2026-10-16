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
