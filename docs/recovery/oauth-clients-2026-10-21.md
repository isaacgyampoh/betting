# OAuth client configuration, recorded before repair — 21 Oct 2026

Read from the authenticated Google Cloud Console, read-only, immediately before any change.
Client IDs and certificate fingerprints are public identifiers; no secrets, tokens or cookies are
recorded here.

## game-claw (400646694915)

| Name | Type | Client ID | Package | SHA-1 | Created |
|---|---|---|---|---|---|
| Android client 1 | Android | `400646694915-uso8a1k…` | `win.gameclaw.app` | `1B:33:66:9C:B0:80:1A:85:50:89:76:86:E4:B7:53:12:D3:8E:74:EC` | 17 Oct |
| Android client 2 | Android | `400646694915-r59d0h59…` | `win.gameclaw.app2` | `C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75` | 19 Oct |
| game-claw | Web | `400646694915-b4oh…` | — | — | 17 Oct |
| GameClaw server | Web | `400646694915-g6t2…` | — | — | 17 Oct |
| GameClaw Supabase Auth | Web | `400646694915-k5ik…` | — | — | 17 Oct |

API keys present: "Android key (auto created by Firebase)", "Browser key (auto created by
Firebase)", both 16 Oct. Service account: `firebase-adminsdk-fbsvc@game-claw.iam.gserviceaccount.com`.

## gameclaw-push-notifications (569032239509)

| Name | Type | Client ID | Package | SHA-1 | Created |
|---|---|---|---|---|---|
| Android client 1 | Android | `569032239509-t6c862s9…` | `win.gameclaw.app` | `C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75` | 18 Oct |

This is the only OAuth client in the project.

## Intended change

1. Delete `t6c862s9` from the push project. It holds the production package and release
   fingerprint in a project that does not own the audience, which is what blocks the correct
   registration. Nothing references it: the project's Firebase Android app lists no SHA
   certificates, the shipped `google-services.json` has no `oauth_client` entries, the app's
   audience is `b4oh5at…` in game-claw, and FCM authenticates by service account and API key —
   push was verified end to end on 21 Oct while this client sat unused.
2. Edit `r59d0h59` in game-claw: package `win.gameclaw.app2` → `win.gameclaw.app`, keeping its
   already-correct release fingerprint.

## Recovery

The Console's credentials page offers **"Restore deleted credentials"**, so step 1 is reversible
within Google's retention window. If anything regresses, restore `t6c862s9` and revert
`r59d0h59`'s package to `win.gameclaw.app2` using the values in the table above.

`uso8a1k` (debug) and all three Web clients are not touched.
