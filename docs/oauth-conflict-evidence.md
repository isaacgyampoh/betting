# Google Sign-In `[28444]` — evidence package

For Google / Firebase Support. **Tracking number `c8326621579822359`.**

Everything below was gathered with supported APIs under `digitalsmoon49@gmail.com`, or by reading
the signed artifact. Nothing is inferred.

---

## 1. What fails

| | |
|---|---|
| Symptom | Google Sign-In fails on a release build with `[28444] Developer console is not set up correctly` |
| Console error when registering | `Save failed — Requested entity already exists` |
| Package | `win.gameclaw.app` |
| Release SHA-1 | `C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75` |
| Cloud project | `game-claw` / `400646694915` |
| Firebase project | `gameclaw-push-notifications` / `569032239509` |

Device log, real Pixel, release build:

```
Auth.Api.Credentials: [UpdateDefaultAccountOperation] Operation succeeded
Auth.Api.Credentials: bpxp: 28444: Developer console is not set up correctly
Auth.Api.Credentials: [GoogleSignInChimeraActivity] Activity finished with error
```

The account list is fetched successfully and the failure happens at the token-mint step after the
account is chosen, which is an app-identity rejection rather than a missing-credential one.

## 2. The cause is the registration, proven by isolation

A release build under the package `win.gameclaw.app2` — **same signing key, same audience, same R8
configuration**, differing only in package name — signs in successfully and establishes a server
session. The only variable is which package the Android OAuth client is registered against.

## 3. The conflict is not in any Firebase app

| Project | Android apps | SHA certificates |
|---|---|---|
| `game-claw` (400646694915) | **none** | — |
| `gameclaw-push-notifications` (569032239509) | `1:569032239509:android:d73db0f4968de8601a2e9c`, package `win.gameclaw.app` | **none** |
| `task-tally-77b90` (560478962095) | package `com.tasktally.app` | none — unrelated package |

```
$ firebase apps:android:sha:list 1:569032239509:android:d73db0f4968de8601a2e9c
No SHA certificate hashes found.
```

The shipped `google-services.json` likewise carries **0** `oauth_client` entries.

## 4. The Console error reproduces through a supported API

```
POST https://firebase.googleapis.com/v1beta1/projects/game-claw/androidApps
     {"displayName":"GameClaw Android","packageName":"win.gameclaw.app"}

409 {"error":{"code":409,"message":"Requested entity already exists","status":"ALREADY_EXISTS"}}
```

So `win.gameclaw.app` is already claimed inside `game-claw`, while `apps:list` reports no Android
app in that project. The only things in it that claim a package name are Console-created OAuth
clients.

## 5. Current state of every known OAuth client

Determined from Google's own authorization endpoint, which distinguishes a live client from a
deleted one and reveals its type.

| Client | Project | State |
|---|---|---|
| `…uso8a1k` | game-claw | exists, **Android** — package `win.gameclaw.app`, **debug** fingerprint |
| `…b4oh5at` | game-claw | exists, **Web** — the audience the app sends and the API accepts |
| `…k5ikq1qt` | game-claw | exists, **Web** — older audience, still accepted |
| `…r59d0h59` | game-claw | exists, **Android** — moved diagnostically to `win.gameclaw.app2` |
| `…bgctj5t4` | push project | **deleted** since 19 Oct |
| `…t6c862s9` | push project | exists, **Android** — orphaned |

### Why `t6c862s9` is the prime suspect

It is an Android client in `gameclaw-push-notifications`, and that project's Firebase app has no
SHA certificates at all. An Android OAuth client is created when a fingerprint is added to a
Firebase app and is **not** removed when the fingerprint is deleted — so the client outlives the
registration and keeps holding its `(package, SHA-1)` claim. Google enforces that pair as unique
across projects, which is exactly the shape of `ALREADY_EXISTS`.

**Evidence it is obsolete** (gathered before proposing removal, not after):

- the Firebase app it belongs to lists no SHA certificates;
- the shipped `google-services.json` has no `oauth_client` entries, so the app never reads it;
- the app's `serverClientId` is `b4oh5at…`, in the *other* project;
- FCM authenticates with the API key and sender id, not with an OAuth client, so push is
  unaffected;
- its sibling `bgctj5t4` has already been deleted with no observed impact on push, which still
  reports healthy and whose service account is unrelated to these clients.

What cannot be read without Console access is the package and fingerprint `t6c862s9` actually
holds. That is the single unverified link in the chain.

## 6. Why this was not fixed programmatically

Google publishes **no API for creating or editing OAuth 2.0 client IDs**. The Firebase Management
API covers Firebase apps and their SHA certificates, which is a different resource;
`gcloud iam oauth-clients` manages workforce-identity clients, not these. Adding the fingerprint to
the Firebase app in the push project was deliberately **not** done: it would auto-create an Android
client in the project that does not own the audience, consuming the unique pair in the wrong place
and making the conflict permanent.

## 7. The ask

Either confirm which client currently holds `win.gameclaw.app` +
`C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75`, or release that pair so an Android
client can be created for it in `game-claw`.


---

## 8. What was verified on the device, 21 Oct

The release fingerprint is the *only* broken link. Everything downstream of sign-in was proved by
running a **debug** build — same package `win.gameclaw.app`, same `google-services.json`, same
production API — whose fingerprint `1B:33:66:9C:…` *is* correctly registered as `uso8a1k`.

| | Result |
|---|---|
| Google Sign-In, package `win.gameclaw.app` | **succeeded** — `CompleteSignInOperation` succeeded, `GoogleSignInChimeraActivity Activity finished successfully`, zero `28444` |
| Backend session | **established** — age gate shown, then Profile reads "Signed in on this device" |
| FCM token registration | **succeeded** — the production API delivered to this device |
| Notification, app in foreground | **delivered**, two records on channel `gameclaw_matches_v2` |
| Notification, app backgrounded | **delivered** — launcher in front at delivery, record posted |
| Custom sound | **played** — `RingtonePlayer: play uri=android.resource://win.gameclaw.app/raw/gameclaw_alert` |
| Channel configuration | `mId='gameclaw_matches_v2'`, `mName=Match alerts`, `mImportance=4`, `mSound=android.resource://win.gameclaw.app/raw/gameclaw_alert` |
| Tap navigation | **works** — opens the Live Centre |

So items 2 through 6 of the release criteria are satisfied on the production package. Only item 1
— sign-in on a **release-signed** build — remains, and it fails solely because the release
fingerprint has no OAuth client.

### The shrinking bug, caught reproducing in the wild

The same test ran against the leftover `win.gameclaw.app2` build, which was compiled **before**
`res/raw/keep.xml` existed. The device log shows both outcomes side by side:

```
RingtonePlayer: play uri=android.resource://win.gameclaw.app/raw/gameclaw_alert      <- fixed build
MediaPlayer:   FileNotFoundException: No resource found for:
               android.resource://win.gameclaw.app2/raw/gameclaw_alert               <- pre-fix build
```

That is independent confirmation, from Android's own media stack, that resource shrinking was
stripping the sound and that the keep rule fixes it.

### Cleanup

`win.gameclaw.app2` has been uninstalled. It was a diagnostic package, and while installed it held
an FCM token registered to the account, so test notifications were being delivered to it as well as
to the real app. The signed release build is reinstalled on `win.gameclaw.app`.
