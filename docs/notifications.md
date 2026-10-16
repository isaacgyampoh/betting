# Native Android notifications

The app uses **Firebase Cloud Messaging**. The marketing site's Web Push setup is untouched and
keeps working: `push_subscriptions` is browser Web Push, keyed on an endpoint URL with its own
crypto, and a phone cannot produce one. The two live side by side.

## What is already implemented

| Piece | Where |
|---|---|
| Device table | `device_tokens`, migration `20261016120000_device_tokens` |
| Register / revoke | `POST` and `DELETE /api/v1/devices`, `lib/services/devices.ts` |
| Flutter client | `gameclaw_app/lib/data/push.dart` |
| Permission + setting | Profile → Notifications |
| Lifecycle | Registers when a session appears; unregisters **before** sign-out clears it |

The identifier Firebase gives us belongs to an **install**, not a sign-in. The table makes it
unique and re-registration reassigns the row, so a second user on a shared phone cannot inherit
the first one's alerts. Signing out revokes that device only — other devices on the account keep
theirs, because signing out of a phone says nothing about a tablet.

Firebase is optional at build time. Without `google-services.json` the Gradle plugin is not
applied, `Firebase.initializeApp()` fails, and the app runs with no push rather than not running.
Verified: a debug APK builds and installs with no Firebase configuration present.

## What still needs a Google account

A Firebase project. Nothing below can be done from this repository.

1. Open <https://console.firebase.google.com> and **Add project** — call it `gameclaw`.
   Google Analytics is not needed; leave it off.
2. In the project, **Add app → Android**.
   - Package name: **`win.gameclaw.app`** — exactly this, it is the app's permanent identity.
   - Nickname and debug signing certificate can both be skipped.
3. Download **`google-services.json`** and put it at:

   ```
   gameclaw_app/android/app/google-services.json
   ```

   It is gitignored and must stay that way.

4. For the server to *send*, Firebase → Project settings → Service accounts → **Generate new
   private key**. That file is a credential: do not commit it, and do not paste it anywhere. It
   goes in as a Worker secret:

   ```bash
   npx wrangler secret put FCM_SERVICE_ACCOUNT --config wrangler.api.jsonc < ~/Downloads/<file>.json
   ```

## Cost

FCM has no per-message charge and the Spark (free) plan covers it. Nothing here enables Blaze or
any paid Firebase product. Do not enable other Firebase products while in the console — none is
needed.

## Not yet built

Sending. The registration half is complete and testable; the sender needs the service-account
credential above, and until a real notification has arrived on a real device nothing here should
be described as working.
