# Google Play readiness

Audited 2026-10-17 against the real project and Google's current policy text.

**Read §1 before doing any of the rest.** The technical work is nearly done; whether the app is
allowed on Play at all is the open question, and it is a business and licensing matter rather
than a coding one.

---

## 1. The policy question, which outranks everything else

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
| `compileSdkVersion` | 36 |
| `minSdkVersion` | 24 |
| Secrets in the artifact | **none** — scanned the extracted APK for JWTs, `sk_live`, `AIzaSy`, private keys, database URLs |
| Version | `versionCode 1`, `versionName 1.0.0` |
| R8 / minification | runs and the minified build works on device |

### Signing — not done, and deliberately not done by me

```
~/keys/gameclaw-upload.jks      not created
android/key.properties          absent
```

There is no upload key. Creating one is a step only you should take, because the key is the
permanent identity of the app on Play: whoever holds it can ship updates, and losing it means
losing the ability to update under the listing at all. `docs/release-signing.md` has the exact
commands and the backup advice.

**After creating it**, two things follow immediately:

- The release build's SHA-1 differs from the debug key's, so Google sign-in **will not work in a
  release build** until an Android OAuth client exists for the upload-key fingerprint, and
  another for the Play App Signing fingerprint once Play has re-signed. See
  `docs/release-signing.md` §5. This is the same failure already debugged once, and it will
  present identically.
- Nothing has yet been tested in a release-signed build, because there is no key to sign with.

---

## 3. Store listing and account requirements

| | Status |
|---|---|
| Privacy policy | **not written** — required, and must cover what the app collects |
| Data safety form | not completed. The app collects: Google account id and email, device push token, slips and selections |
| Content rating (IARC) | not completed. A gambling-adjacent app will not rate as low as it might look |
| Account deletion | **required** by Play for apps with accounts, including a **web** route, not only in-app |
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

1. Put the policy question to Google in writing. Everything else is wasted effort if the answer
   is no, and the answer is not predictable from the policy text alone.
2. Create and back up the upload key (`docs/release-signing.md`).
3. Register Android OAuth clients for the upload-key and Play App Signing fingerprints.
4. Build a release-signed artifact and test sign-in, following, match detail and conversion on it
   — none of which has been exercised in a release build yet.
5. Write the privacy policy and complete the data safety form honestly.
6. Check the account type and start closed testing early if the 14-day clock applies.
