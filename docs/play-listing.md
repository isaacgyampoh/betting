# Google Play submission materials

Everything the Console asks for that can be written before you log in. Answers are derived from
`prisma/schema.prisma` and the built artifact, not from memory, so the Data safety form and
`/privacy` agree — a mismatch between those two is a review failure on its own.

**Read `docs/play-readiness.md` §1 first.** Whether a slip-conversion app is permitted on Play at
all is unresolved, and nothing in this file changes that.

---

## 1. Release artifact

| | |
|---|---|
| Package | `win.gameclaw.app` |
| Version | `versionCode 1`, `versionName 1.0.0` |
| Format | Android App Bundle, 75.6 MB |
| Signing | `CN=GameClaw, OU=GameClaw, O=GameClaw, L=Accra, ST=Greater Accra, C=GH`, `jar verified` |
| Upload-key SHA-1 | `C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75` |
| `targetSdk` / `compileSdk` / `minSdk` | 36 / 37 / 24 |
| Diagnostic package | absent — zero occurrences of `gameclaw.app2` in the bundle |

`versionCode 1` is only correct for the very first upload. Every later one must increase it, and
Play rejects a repeat rather than overwriting.

---

## 2. Data safety

Each row is a table in the schema. "Collected" means it leaves the device; "shared" means a third
party receives it.

| Data type | Collected | Shared | Required | Purpose | Where |
|---|---|---|---|---|---|
| Email address | yes | no | yes | account | `profiles.email` |
| Name | yes | no | no | account | `profiles.display_name` |
| Profile photo (URL) | yes | no | no | account | `profiles.avatar_url` |
| Google account identifier | yes | no | yes | sign-in | `identities.subject` |
| App activity — slips and selections | yes | no | yes | core feature | `slips`, `selections` |
| App activity — followed teams and matches | yes | no | no | notifications | `follows` |
| App activity — assistant messages | yes | **yes** | no | the assistant | sent to Anthropic |
| App activity — usage counts | yes | no | yes | plan limits | `usage_logs` |
| Device identifier — push token | yes | **yes** | no | notifications | `device_tokens`, sent to Firebase |
| Approximate location | **no** | no | — | — | not collected |
| Precise location | **no** | no | — | — | not collected |
| Financial info | **no** | no | — | — | payments are not configured |
| Contacts, photos, files, calendar, SMS | **no** | no | — | — | not collected |

Answers to the standard questions:

- **Is all data encrypted in transit?** Yes — HTTPS throughout.
- **Can users request deletion?** Yes. In-app (Profile → Delete account) and on the web at
  `https://gameclaw.win/delete-account`. Play requires the web route; give it this URL.
- **Is data collected required to use the app?** Partly. Live scores and the published record are
  usable signed out; building or converting a slip needs an account.
- **Independent security review?** No. Do not claim one.

Note the IP address: rate limiting stores a one-way hash, never the address. That is not
"collecting an IP" for the form's purposes, but say so plainly if asked.

---

## 3. Store listing

**App name** (30 max): `GameClaw`

**Short description** (80 max):

> Live football scores, stats, and move a betting slip between bookmakers.

**Full description** (4000 max):

> GameClaw is a football app for people who follow the game closely and bet occasionally.
>
> **Live scores that are actually live.** Every match in play, grouped by competition, with the
> minute and the score updating as they happen. Match Centre carries the timeline, shots, corners,
> cards, possession where the competition publishes it, lineups, the table and head-to-head.
>
> **Follow what you care about.** Follow a team or a single match and get kick-off, goals and full
> time — and nothing else.
>
> **Move a slip between bookmakers.** Paste a booking code from one bookmaker and GameClaw rebuilds
> the same selections at another, so you can take a price somewhere else. It says plainly which
> bookmakers it can read and which it can book at, and why the others cannot.
>
> **Combine two slips.** Pick the games you want from several codes and book the combination at one
> bookmaker.
>
> **What GameClaw does not do.** It takes no money, holds no stake and accepts no bets. It is not a
> bookmaker. Every chance it shows is an estimate from past results, and a long price is long for a
> reason.
>
> 18+. Betting costs money over time. Decide what you are willing to lose before you stake it, and
> stop when you reach it.

Write nothing that hides the conversion feature. Misrepresenting functionality to get through
review is its own violation and risks the developer account, not just the listing.

**Category**: Sports. **Contact email**: `support@gameclaw.win`. **Privacy policy**:
`https://gameclaw.win/privacy`.

---

## 4. Graphics — not yet produced

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | in the bundle; needs exporting at this size |
| Feature graphic | 1024×500 PNG/JPG | **missing, and required** |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | capturable from the Pixel |
| Tablet screenshots | optional | none |

Three real screenshots already exist in `public/screens/` for the website — Live Centre, Convert,
Merge — taken on a real Pixel against production. They are the right source. Do not mock any up:
a betting tool asking for a booking code is asking for trust.

---

## 5. Content rating

Answer the IARC questionnaire honestly: the app references real-money gambling and links out to
licensed bookmakers, while itself taking no stake. **Expect a high rating** — a gambling-adjacent
app does not rate as low as its content might suggest, and Play's own policy requires AO/18+ for
licensed gambling apps.

Declare: no violence, no sexual content, no profanity, no user-to-user communication, no ads.
Simulated or real gambling: **real-money gambling references, with links to external bookmakers.**

---

## 6. App access for reviewers

Sign-in is Google-only, so a reviewer cannot use a username and password. Provide:

> Live scores, Match Centre, competitions and the published record are fully usable **without
> signing in** — open the app and they are the first screen.
>
> Signing in requires a Google account and unlocks slip building and booking-code conversion. To
> review those, please use the demo account below, or contact us and we will enable a reviewer
> account on request.

A demo Google account has to exist before this is written into the Console. It does not yet.

---

## 7. Account and testing-track requirements

- A **personal** developer account created after 13 Nov 2023 must run a closed test with **12
  testers opted in continuously for 14 days** before applying for production. That is a hard
  calendar floor regardless of how ready the build is.
- Which type this account is, and when it was created, is in Console → Account details. **Check it
  first**: it decides whether production is days away or a fortnight.
- After the first upload, Play re-signs with its own key. A **third** Android OAuth client must be
  registered for the Play App Signing SHA-1, or Google sign-in breaks for everyone who installs
  from the store — the same failure already debugged twice here.
