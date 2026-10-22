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


---

## 9. The controlled A/B, same device, same hour

Both builds were run on the same Pixel within twelve minutes of each other, against the same
production API, under the same package `win.gameclaw.app`, with the same `google-services.json`
and the same `serverClientId`. The signing key is the only difference.

```
23:00  debug build,   SHA-1 1B:33:66:9C:…  (registered as uso8a1k)
       Auth.Api.Credentials: [CompleteSignInOperation] Operation succeeded
       Auth.Api.Credentials: [GoogleSignInChimeraActivity] Activity finished successfully

23:12  release build, SHA-1 C9:B5:19:40:…  (no OAuth client)
       Auth.Api.Credentials: [CompleteSignInOperation] Operation started
       Auth.Api.Credentials: bpxp: 28444: Developer console is not set up correctly
       Auth.Api.Credentials: [GoogleSignInChimeraActivity] Activity finished with error
       Auth.Api.Credentials: [CompleteSignInOperation] Operation failed
```

Every other explanation is eliminated by construction: R8, the audience, the backend, the Firebase
configuration, the package name and the consent screen are identical across the two runs.

## 10. Why `t6c862s9` has not been touched

Its package name and fingerprint cannot be read through any available interface, and that is the
precondition this work set for removing it. What is known: it is an Android client in
`gameclaw-push-notifications`, and it is **not** attached to that project's Firebase app — the
app's `oauth_client` list is empty, so the client is standalone rather than Firebase-managed.

The one programmatic probe that would settle it — adding the release fingerprint to the push
project's Firebase app and seeing whether Google returns `ALREADY_EXISTS` — was deliberately not
run, because its outcomes are asymmetric. A failure would be information; a success would create
an Android client for the pair in the project that does **not** own the audience, and deleting the
SHA afterwards does not delete the client it created. `t6c862s9` itself is the evidence for that:
it still exists while its app has no SHA certificates. So a "successful" probe would consume the
pair permanently and convert a recoverable problem into an unrecoverable one.


---

## 11. RESOLVED: the conflicting entity, read directly from the Console

Read on 21 Oct through the already-authenticated Safari session, read-only
(`scripts/console-inspect.sh`). Form **values** had to be read from `<input>` elements, because
`innerText` does not include them — which is why the list view and every API route came up short.

| Client | Project | Name | Package | SHA-1 |
|---|---|---|---|---|
| `…uso8a1k` | game-claw | Android client 1 | `win.gameclaw.app` | `1B:33:66:9C:…:74:EC` (**debug**) |
| `…r59d0h59` | game-claw | Android client 2 | `win.gameclaw.app2` | `C9:B5:19:40:…:13:75` (**release**) |
| `…t6c862s9` | **gameclaw-push-notifications** | Android client 1 | **`win.gameclaw.app`** | **`C9:B5:19:40:…:13:75`** |

**`t6c862s9` is the conflict.** It holds the exact pair — production package *and* release
fingerprint — in the push project, which does not own the audience the app sends. Google enforces
that pair as unique across projects, so `game-claw` cannot have it while this client exists. That
is the `ALREADY_EXISTS`, and it is also the `[28444]`: GMS resolves the app's identity to a client
in 569032239509 while the token is requested for an audience in 400646694915.

The earlier suspicion was right, but it is now read rather than inferred.

### The alternative fix does not exist

Repointing the app's audience at a Web client in the push project would also resolve the
cross-project mismatch without deleting anything. The Console shows that project contains exactly
**one** OAuth client — `t6c862s9` itself. There is no Web client to point at.

### Dependencies, checked before recommending removal

- it is the only OAuth client in that project, created 18 Oct;
- the project's Firebase Android app lists **no** SHA certificates, so Firebase does not manage it;
- the shipped `google-services.json` has **no** `oauth_client` entries, so the app never reads it;
- the app's `serverClientId` is `b4oh5at…`, in the other project;
- FCM authenticates with the service account and API key, not with an OAuth client — and push was
  verified working end-to-end on 21 Oct *while this client existed and went unused*;
- sign-in currently fails **because** it exists.

It provides no function and actively blocks the correct registration.

### Also found

`game-claw` holds a fifth client not previously known here: **`…g6t2`, "GameClaw server"**, a Web
application created 17 Oct. Not used by the app, whose audience is `b4oh5at…`. Left alone.

### The fix, in order

1. Delete `t6c862s9` from `gameclaw-push-notifications`, freeing the pair.
2. In `game-claw`, create an Android OAuth client: package `win.gameclaw.app`, SHA-1
   `C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75`.
3. Re-run the release-signed verification on the Pixel.

Step 2 can equally be done by editing `r59d0h59`'s package from `win.gameclaw.app2` back to
`win.gameclaw.app`, since it already carries the right fingerprint — but only after step 1, which
is what has been rejecting that edit all along.


---

## 12. RESOLVED — verified on the release-signed build, 21 Oct 23:54

The owner freed the unique pair by **renaming** rather than deleting: `t6c862s9` in the push
project was moved to package `win.gameclaw.app3`, which released
`(win.gameclaw.app, C9:B5:19:…:13:75)`, and `r59d0h59` in `game-claw` was then edited back to
`win.gameclaw.app`. Better than the deletion this document proposed — nothing was destroyed, and
both clients remain available to roll back.

Confirmed by reading both clients afterwards:

| Client | Project | Package | SHA-1 |
|---|---|---|---|
| `r59d0h59` | **game-claw** | **`win.gameclaw.app`** | `C9:B5:19:40:…:13:75` |
| `t6c862s9` | push project | `win.gameclaw.app3` | `C9:B5:19:40:…:13:75` |

The Android client and the audience `b4oh5at…` now live in the same project, which is what GMS
requires.

### Release-signed verification, on the Pixel

Installed certificate read back off the device: `c9b5194033db5338ec3ee794a0d967b152001375`.

| | Evidence |
|---|---|
| Google Sign-In | `[CompleteSignInOperation] Operation succeeded`, `Activity finished successfully`, **zero `28444`** |
| Backend session | Profile reads "Signed in on this device" |
| FCM registration | Match alerts toggle engaged; the production API delivered to this device |
| Notification, foreground | delivered, channel `gameclaw_matches_v2` |
| Notification, backgrounded | delivered with the launcher in front |
| Custom sound | `RingtonePlayer: play uri=android.resource://win.gameclaw.app/raw/gameclaw_alert` — **no** `FileNotFoundException`, so `res/raw/keep.xml` holds under resource shrinking |
| Channel | `mImportance=4`, `mSound=android.resource://win.gameclaw.app/raw/gameclaw_alert` |
| Tap navigation | app was on **Profile**; tapping the notification opened the **Live Centre**, the payload's `/home` — so it navigated rather than merely resuming |
| Match Centre / live scores | rendering, minutes advancing, `HT` label correct |

The first tap test was inconclusive and is worth recording: the app resumed to Profile instead of
navigating, which looked like a routing bug. It was not. Two notifications had been bundled into a
group and the tap landed on the group summary, which carries no payload. Clearing the shade and
repeating with a single notification — from Profile, so that "resumed where it was" could not be
mistaken for success — navigated correctly.
