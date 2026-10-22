# Google Play readiness

Audited 2026-10-17 against the real project and Google's current policy text, and updated
2026-10-19 where the position has moved. §1 has not moved and still outranks the rest.

**Read §1 before doing any of the rest.** The technical work is nearly done; whether the app is
allowed on Play at all is the open question, and it is a business and licensing matter rather
than a coding one.

---

## 1. The policy question, which outranks everything else

> **Superseded, 22 Oct 2026 — read `play-policy-assessment.md` instead.**
>
> The section below cites two passages as general prohibitions. Both are in the policy's **ads**
> section: they are conditions a non-gambling app must meet in order to *carry gambling ads*.
> GameClaw carries no ads, so neither applies, and the "sports odds tracker" violation example is
> a violation because of its integrated gambling ads linking to a betting site — GameClaw has
> neither.
>
> Its conclusion, "Directing users to a betting site is the product", is also wrong about the
> build: `url_launcher` is not a dependency and the app cannot open a URL at all. A booking code
> reaches the user by clipboard or share sheet.
>
> The real exposure is narrower and is assessed properly in the new document: the general rule
> that Play "doesn't allow content or services that enable or facilitate users' ability to wager",
> against a feature that creates a bet slip at a bookmaker. Left below for the record.


Google Play's *Real-Money Gambling, Games, and Contests* policy
(<https://support.google.com/googleplay/android-developer/answer/9877032>) says Play "generally
prohibits apps from facilitating real-money gambling", with an exception for licensed operators
who complete an application process.

Two passages bear directly on GameClaw. Quoted exactly:

> **"A dedicated sports odds tracker app containing integrated gambling ads linking to a sports
> betting site"** — listed among the **violation examples**.

> **"App content must not promote or direct users to gambling or real money games, lotteries, or
> tournament services"** — from the requirements a non-gambling app must meet to carry gambling
> ads.

GameClaw shows odds and statistics, and its central feature produces a booking code that sends
the user to a bookmaker to stake it. **Directing users to a betting site is the product**, not an
advertisement inside it. It is difficult to read that as anything other than the behaviour the
policy describes — and the fact that the links are core functionality rather than ads makes the
case worse, not better: an ad can be removed, a feature cannot.

What GameClaw does **not** do, and this matters: it accepts no wagers, holds no stake, processes
no gambling money, and does not itself operate a book. The policy's prohibited list is mostly
about accepting money and managing wagers, none of which applies.

So the honest position is: **GameClaw sits in the part of this policy that is written about, not
in the part that is clearly permitted.** Nobody should submit it assuming approval.

### The licensed route, and what it would require

Play allows "valid licensed or authorized gambling apps" offering Sports Betting among other
products. Every one of these is required:

| Requirement (quoted) | GameClaw today |
|---|---|
| "Developer must successfully complete the application process" | not started |
| "Developer must have a valid gambling license for each country or state/territory in which the app is distributed" | **none held** |
| "App must prevent under-age users from using the app" | 18+ gate exists (`age_gate_screen.dart`) |
| "App must prevent access and use from countries… not covered" | **no geo-restriction** |
| "App must NOT be purchasable as a paid app… nor use Google Play In-app Billing" | satisfied — no payment in the app at all |
| "App must be free to download and install" | satisfied |
| "App must be rated AO (Adult Only) or [IARC equivalent]" | rating not yet completed |
| "App and its app listing must clearly display information about responsible gambling" | in-app section exists; listing not written |

The licence is the hard one. GameClaw is not an operator and does not hold a Gaming Commission
licence, so the licensed route may simply not be open to it as it stands.

### What to actually do

This needs a decision, and possibly advice, before any build is uploaded:

1. **Ask Google**, through Play Console policy support, describing the app honestly: football
   data and statistics, plus a tool that converts a betting slip between licensed bookmakers
   without accepting stakes. Get the answer in writing before building a release around it.
2. **Consider what a compliant version looks like** if the answer is no — football data,
   statistics, following and Claw are a complete product without slip conversion, and conversion
   could live on the web where this policy does not reach.
3. **Do not** describe the app in a way that hides the conversion feature. Misrepresenting
   functionality to get through review is its own violation and risks the developer account, not
   just the app.

---

## 2. Technical readiness

Verified by reading the built artifact, not the configuration that is supposed to produce it.

| | Status |
|---|---|
| Package | `win.gameclaw.app` — confirmed in the APK manifest |
| `targetSdkVersion` | **36**, confirmed in the APK. Meets the requirement in force since 31 Aug 2026 |
| `compileSdkVersion` | 37 — raised for receive_sharing_intent; `targetSdk` deliberately left at Flutter's default |
| `minSdkVersion` | 24 |
| Secrets in the artifact | **none** — scanned the extracted APK for JWTs, `sk_live`, `AIzaSy`, private keys, database URLs |
| Version | `versionCode 1`, `versionName 1.0.0` |
| R8 / minification | runs and the minified build works on device |

### Signing — done since this was written

An upload key now exists, with `key.properties` pointing at it and a backup kept outside the
repository. `docs/release-signing.md` records the detail; the fingerprint is
`C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75`, and a signed APK and AAB have both
been built and verified against it.

The consequence predicted here arrived exactly as described: the release build's SHA-1 differs
from the debug key's and **Google sign-in fails in a release build** with
`[28444] Developer console is not set up correctly`. It is not a signing fault. The Android OAuth
client in project `game-claw` is registered against the package `win.gameclaw.app2` — a diagnostic
identity created to work around a console save error — rather than `win.gameclaw.app`. A release
build under `win.gameclaw.app2`, same key and same audience, signs in successfully, which isolates
it to that one registration. See `docs/release-signing.md`, 19 Oct.

Still outstanding, and unchanged: a third Android OAuth client is needed for the **Play App
Signing** fingerprint once Play re-signs the first upload, or sign-in will break again for
everyone who installs from the store.

---

## 3. Store listing and account requirements

| | Status |
|---|---|
| Privacy policy | **written** — `/privacy`, rewritten 19 Oct against `prisma/schema.prisma` so the Data safety form can be filled in to match it |
| Data safety form | not completed. The app collects: Google account id and email, device push token, slips and selections |
| Content rating (IARC) | not completed. A gambling-adjacent app will not rate as low as it might look |
| Account deletion | **done** — `DELETE /api/v1/me`, a control in the app's Profile tab, and `/delete-account` on the site for the web route Play requires |
| Store listing, screenshots, feature graphic | not prepared |
| Reviewer access | needed — reviewers must be able to sign in. Google sign-in with a test account is the obvious route |

### Closed testing, if this is a personal account

A **personal** developer account created after 13 November 2023 must run a closed test with
**at least 12 testers opted in continuously for 14 days** before it can apply for production
access. That is a hard 14-day floor on the calendar regardless of how ready the build is.

I cannot see which type your account is or when it was created — that is in Play Console under
*Account details*. **Check it, because it decides whether production is two weeks away or not.**

---

## 4. Earliest realistic timeline

Assuming the policy question resolves favourably, which is not safe to assume:

| | |
|---|---|
| Internal testing upload | **possible within a day** of an upload key existing |
| Closed testing start | same day as the above |
| Production, organisation account | days, once the listing, rating, privacy policy and data safety form are done |
| Production, personal account post-Nov-2023 | **14 days minimum** after 12 testers are continuously opted in |

**Production availability tomorrow is not realistic.** Even with everything else perfect, the
policy question is unresolved, there is no signing key, no privacy policy, no completed data
safety form and no content rating.

---

## 5. What I would do next, in order

Struck-through items were done between 17 and 19 October.

1. Put the policy question to Google in writing. Everything else is wasted effort if the answer
   is no, and the answer is not predictable from the policy text alone. **Still the first thing.**
2. ~~Create and back up the upload key.~~ Done.
3. Register Android OAuth clients for the upload-key and Play App Signing fingerprints.
   **Half done and currently broken**: the upload-key client exists but is registered against
   `win.gameclaw.app2`, so release sign-in fails. The Play App Signing client cannot be created
   until Play has re-signed a first upload.
4. ~~Build a release-signed artifact~~ — done, APK and AAB both verified. Testing on it is partly
   done: live scores, Match Centre, Claw and slip generation were exercised on a release build;
   **sign-in has only been proved under the `app2` diagnostic package**, and conversion has not
   been re-tested since.
5. ~~Write the privacy policy~~ — done, `/privacy`, rewritten against the schema. The Data safety
   form still has to be filled in to match it, and that is a console task.
6. Check the account type and start closed testing early if the 14-day clock applies. **Still
   unknown and still the longest pole** after the policy question — it is a hard 14-day floor.

### Added since

7. Account deletion is implemented and tested (`DELETE /api/v1/me`, the Profile control, and
   `/delete-account`). The web route is the part Play specifically requires.
8. Store listing, screenshots, feature graphic and content rating remain untouched. None can be
   completed without console access.


---

## 21 Oct — live-score freshness, verified on the device

The 15-minute cache is gone and the fix is confirmed on a real Pixel running the real release
build against production, with **no input at all** during the window:

```
21:59:11   2 matches live   (Mixco 21', Estudiantes Halftime)
22:01:52   5 matches live   (three that kicked off in between, added on their own)
```

The list refreshed itself. That is the client half - `matchDayProvider` was a FutureProvider that
resolved once and sat there - working together with the server's 30-second live overlay.

### One match that does not move, and why it is not ours

Mixco v Municipal read 21' across every sample over several minutes while five other fixtures
advanced in lockstep:

```
22:02:13  Torque=2'  River Plate=3'  Mixco=21'  La Guaira=2'
22:04:29  Torque=4'  River Plate=5'  Mixco=21'  La Guaira=5'
```

Asked API-Football directly about that fixture:

```
fixtures?id=1559657  ->  status.short: 1H   status.long: First Half   elapsed: 21
```

The provider's own feed is stuck, so the app is reporting what it was told. Nothing in GameClaw
can correct that without inventing a minute, which is the one thing this project will not do -
a fabricated clock is indistinguishable from a real one right up until it is wrong.

Worth knowing when comparing against Flashscore or SofaScore: a difference on a particular match
may be a difference in **data contracts**, not in our caching. Check the provider directly before
treating a gap as a GameClaw bug. The test is whether other live fixtures are advancing at the
same moment - if they are, the pipeline is fine.

### A small UI defect found while doing this

The status column truncates "Halftime" to "Half…" on the fixture row. Cosmetic, not wrong, but it
is the kind of thing a reviewer notices on a store screenshot.
