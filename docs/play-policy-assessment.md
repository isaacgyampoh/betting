# Is GameClaw eligible for Google Play?

Assessed 22 October 2026 against Google's current policy text, and against what the app actually
does — read from the code, not from the description in this repository.

**Conclusion in one line: not clearly eligible, and the reason is narrower than previously recorded
here. One feature decides it, and the earlier assessment in `play-readiness.md` §1 cited the wrong
provisions.**

---

## 1. What GameClaw actually does

Verified by inspection, because the policy question turns on specifics:

| | |
|---|---|
| Shows live scores, fixtures, statistics | yes |
| Shows odds | yes — on slips it builds or reads |
| Creates a bet slip at a bookmaker and returns a **booking code** | **yes** — via the bookmaker's own API |
| Opens, links to, or deep-links any bookmaker site or app | **no** — `url_launcher` is not a dependency; there is no outbound navigation anywhere in the app |
| Contains gambling ads | **no** — no ad SDK of any kind |
| Accepts money, holds a stake, manages a wager or balance | **no** |
| Calls to action to wager ("BET!", "REGISTER!", "Place bet") | **no** — the controls read *Convert to another bookmaker*, *Read slip*, *Share slip*, *Booking code* |

The single `sportybet.com` string in the codebase is inside a doc comment giving examples of text
other apps share *into* GameClaw. A booking code reaches the user by clipboard copy or the system
share sheet; the user goes to the bookmaker themselves.

## 2. A correction to what this repository previously said

`play-readiness.md` §1 quoted two passages as though they were general prohibitions:

> "A dedicated sports odds tracker app containing integrated gambling ads linking to a sports
> betting site" — listed among the violation examples.

> "App content must not promote or direct users to gambling or real money games, lotteries, or
> tournament services"

**Both sit in the policy's *ads* section.** They are conditions a non-gambling app must satisfy in
order to **carry gambling ads**, alongside requirement 8, which forbids such an app from providing
"gambling or real money game, lottery, or tournament support or companion functionality" —
expressly including "sports score/odds/performance tracking".

GameClaw carries no ads. None of those requirements are engaged. The violation example is a
violation *because of* the integrated gambling ads linking to a betting site; GameClaw has neither
the ads nor the link.

The earlier conclusion — "Directing users to a betting site is the product" — is also factually
wrong about the current build. The app directs users nowhere; it cannot open a URL.

## 3. The provision that does decide it

> "Google Play generally prohibits apps from facilitating real-money gambling and gaming."
>
> "we don't allow content or services that enable or facilitate users' ability to wager."

This is the general rule, and it is not conditioned on ads.

**The conversion feature is the exposure.** GameClaw calls a bookmaker's API and creates a bet slip
there; the booking code it returns is a pending bet awaiting a stake. Whatever else is true, an
app that creates a slip at a bookmaker on the user's behalf is closer to "enabling or facilitating
the ability to wager" than an app that merely displays odds.

Arguments on the other side, each verified above rather than asserted: no money is taken or held,
no wager is accepted or managed, nothing links to a bookmaker, there is no call to action to
wager, and the user must independently open the bookmaker and stake the code. The separate
"call to action" violation — "apps that invite users to 'BET!' or 'REGISTER!' or 'COMPETE!'" — is
not met.

Honest reading: this is genuinely arguable, and it is not safe to assume either answer. What is
*not* arguable is that the feature is the only thing putting the app in the policy's path. Live
scores, statistics, following and Claw raise no issue under it.

## 4. The licensed route is not open

A licensed gambling app must meet all ten requirements. Two are decisive here:

> "Developer must have a valid gambling license for each country or state/territory in which the
> app is distributed"

> "Developer must successfully complete the application process in order to distribute the app on
> Google Play"

GameClaw holds no gambling licence and is not an operator. The exception is unavailable as things
stand.

## 5. Age-gating is not sufficient — and the rule changed in 2026

Google's **Age-Restricted Content and Functionality** policy, announced 30 October 2025, applies to
"apps with features that include matchmaking, dating or real money gambling/games/contests" and
requires developers "to use Play Console features to block minors".

So an in-app 18+ confirmation does not discharge the obligation, whatever its quality. GameClaw's
gate is better than most — it is enforced **server-side**, with the API returning
`403 AGE_NOT_CONFIRMED` until the profile records a confirmation, so it cannot be bypassed by
patching the client — but it is still self-declared, and it is not the Play Console control the
policy names.

If GameClaw is treated as facilitating real-money gambling, this policy applies and the Console
setting must be used. If it is not, the policy does not apply. The two questions have the same
answer, which is another reason to get that answer in writing.

## 6. Conclusion, and the two defensible paths

**Do not submit as-is assuming approval.** The conversion feature places the app in the scope of a
prohibition it has no licence-based exception for.

**Path A — ask, in writing, first.** Put the question to Play Console policy support describing the
app honestly: football data and statistics, plus a tool that rebuilds an existing bet slip at
another licensed bookmaker and returns a booking code, taking no stake and linking nowhere. Ask
specifically whether booking-code conversion is "facilitating" within the policy. Everything else
is ready, so this is the cheapest next step and the only one that resolves the ambiguity.

**Path B — ship the part that is clearly eligible.** Live scores, Match Centre, competitions,
following, notifications and the published record raise no issue under this policy at all. That is
a complete football product. Conversion could stay on the web, where this policy does not reach.
This is a smaller release, not a worse one, and it does not depend on Google's answer.

What would make Path A fail cleanly rather than expensively: do not describe the app in a way that
omits conversion. Misrepresenting functionality to get through review is itself a violation and
risks the developer account rather than only the listing.

---

## 7. Play App Signing: adding the third fingerprint

This is a procedure, not a policy question, and it will break sign-in exactly as the last
fingerprint mismatch did if it is skipped.

When the first AAB is uploaded, Google re-signs the app with its own key. Installs from the Play
Store therefore carry a **different certificate** from the upload key, and the Android OAuth client
registered for the upload fingerprint will not match them. Sign-in fails with `[28444]` for every
store install while continuing to work on locally installed builds — the same failure already
debugged twice in this project.

Current state, which must be preserved:

| Fingerprint | Purpose | OAuth client |
|---|---|---|
| `1B:33:66:9C:B0:80:1A:85:50:89:76:86:E4:B7:53:12:D3:8E:74:EC` | debug key | `uso8a1k…` (`win.gameclaw.app`) |
| `C9:B5:19:40:33:DB:53:38:EC:3E:E7:94:A0:D9:67:B1:52:00:13:75` | upload key | `r59d0h59…` (`win.gameclaw.app`) |
| *(issued by Google on first upload)* | **Play App Signing key** | **to be created** |

After the first upload, in Play Console:

1. **Test and release → Setup → App integrity → App signing**.
2. Copy the **SHA-1 certificate fingerprint** under *App signing key certificate*. This is Google's
   key, not the upload key — the page lists both, and taking the wrong one reproduces the bug.
3. In Google Cloud Console, project **`game-claw`** → APIs & Services → Credentials →
   **+ Create credentials → OAuth client ID → Android**, package `win.gameclaw.app`, that SHA-1.
4. Create it as a **new** client. Do not edit `r59d0h59`: the upload fingerprint must keep working
   for locally installed builds, and an Android client binds exactly one package to one
   fingerprint.
5. Verify by installing from the Play track — internal testing is enough — and signing in. A
   locally installed APK will not exercise this path.

Google's uniqueness constraint applies here too: `(package, SHA-1)` must be unique across all
projects. The Play signing fingerprint is new, so no conflict is expected — but if the Console
reports `ALREADY_EXISTS`, see `oauth-conflict-evidence.md` for how the last one was found and
freed.
