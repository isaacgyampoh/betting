# App Store Connect: the listing, field by field

Everything here is ready to paste **except** the items marked **NEEDS YOU**, which require a legal
decision, an Apple account, or a judgement that is yours to make.

Nothing in this document claims a licence, an approval, an endorsement or a capability the app does
not have. Where a field would require such a claim, it says so instead of inventing one.

---

## Identity

| Field | Value |
|---|---|
| **App name** (30 char max) | `GameClaw` |
| **Subtitle** (30 char max) | `Live football and bet slips` (27) |
| **Bundle ID** | `win.gameclaw.app` |
| **SKU** | `gameclaw-ios-001` |
| **Primary category** | Sports |
| **Secondary category** | Utilities |
| **Version** | 1.0.0 |
| **Build** | 1 |
| **Copyright** | **NEEDS YOU** — `2026 <legal name or company>`. I will not guess at who owns it. |

---

## Description

> GameClaw follows football properly and keeps your betting slips in one place.
>
> **Live scores that keep up**
> Every goal, red card and half-time across the competitions you care about, with the minute
> advancing as the match does. Follow teams and matches and get told when something happens.
>
> **Match detail worth reading**
> Line-ups, possession, shots, corners and cards, plus recent form split into home and away —
> because a team that wins at home and loses away is not the same team twice.
>
> **Claw, for the question you actually have**
> Ask for three games under a price, or what the numbers say about a fixture. Claw answers from
> real fixtures and the bookmaker's own prices, explains the reason behind every pick, and tells
> you when it cannot find one. Every chance it quotes is an estimate from past results, never a
> certainty.
>
> **Move a slip between bookmakers**
> Paste a booking code and GameClaw reads the slip, finds the same games at another bookmaker,
> prices them there and shows you exactly what carries across and what does not — before anything
> is booked. A selection that cannot be found is named, not quietly dropped.
>
> GameClaw does not take bets, hold money or pay out winnings. Bets are placed with the bookmaker,
> under their terms.
>
> You must be 18 or over to use GameClaw. Betting costs money over time. Decide what you are
> willing to lose before you stake it, and stop when you reach it.

## Keywords (100 char max)

```
football,live scores,fixtures,bet slip,booking code,odds,predictions,match stats,sports,lineups
```
(99 characters.) No competitor names, which Apple rejects.

## Promotional text (170 char max)

> Live football scores, match stats that explain themselves, and a booking code you can move
> between bookmakers without re-entering a thing.

---

## URLs

| Field | Value | State |
|---|---|---|
| **Privacy policy URL** | `https://gameclaw.win/privacy` | **live, HTTP 200** |
| **Support URL** | `https://gameclaw.win/support` | **BLOCKED** — page is written and builds, but is not deployed, and `support@gameclaw.win` cannot receive mail. See below. |
| **Marketing URL** | `https://gameclaw.win` | live, HTTP 200 |

### The support address does not work

`gameclaw.win` has **no MX records at all** — not at the apex, and not the `send` subdomain the
Resend setup in `docs/deploy.md` describes. No SPF, no DKIM, no DMARC either. That setup was never
applied, and Resend is not referenced anywhere in the code, so the domain neither sends nor
receives mail today.

Three pages already publish `support@gameclaw.win`: the privacy policy, the account-deletion page,
and the new support page. Apple's reviewer will use it, and so will anyone exercising a data right
under Ghana's Act 843.

**Simplest fix, since DNS is already on Cloudflare** (`ram.ns` / `robin.ns.cloudflare.com`):
Cloudflare **Email Routing** — free, needs no mailbox, forwards `support@gameclaw.win` to an inbox
you already read, and adds the MX and SPF records itself. Any hosted mailbox works equally well.

I have not changed DNS and will not without your say-so.

---

## Age rating

Answer the questionnaire as follows. These follow from what the app does, and each would be
verifiable by a reviewer:

| Question | Answer |
|---|---|
| Gambling and contests | **Yes** |
| Simulated gambling | No |
| Contests | No |
| Unrestricted web access | No |
| Horror / fear themes, violence, sexual content, profanity, drugs | No |

Expected outcome: **18+**. The app already enforces this server-side — the API refuses every
football endpoint until age is confirmed, and self-exclusion is built in and cannot be shortened.

---

## App Review notes

> **What GameClaw does, plainly.**
>
> GameClaw shows live football scores and statistics, answers questions about fixtures using a
> language model, and moves betting slips between bookmakers.
>
> **GameClaw does not take bets.** There is no deposit, no withdrawal, no wallet, no balance and no
> stake field anywhere in the app. It holds no customer money and pays out nothing.
>
> What it does do, and we want the reviewer to see it clearly: it can create a **booking code** at a
> licensed sportsbook. A booking code is a coupon saved on that bookmaker's own system listing which
> selections a person intends to bet on. It carries no stake and no money. To place a bet the user
> must open the bookmaker's own app, enter the code, enter a stake and confirm, under that
> bookmaker's account and identity checks.
>
> The two connected bookmakers, SportyBet Ghana and Football.com Ghana, are licensed by the Gaming
> Commission of Ghana. GameClaw has no affiliate, commission or revenue-share arrangement with
> either; outbound links carry no tracking parameter.
>
> The app is 18+ and enforces it server-side.
>
> **To test the conversion feature:** sign in, open Convert, paste the booking code supplied in the
> demo-account notes, choose SportyBet when asked which bookmaker it is from, then convert to
> Football.com. Booking codes expire, so if the supplied one has lapsed, open Claw and ask for
> "three games from the Premier League, nothing riskier than 1.60" — it will build a slip and issue
> a fresh code.

**NEEDS YOU:** whether to submit at all, and what to say about licensing, depends on the legal
assessment in `docs/apple-5-3-4-evidence.md`. Do not paste the above until a lawyer has read that.

## Demo account

**NEEDS YOU.** Apple requires working credentials for an 18+, sign-in-gated app. Options:

- a Google account kept for review, with age already confirmed and a valid booking code in the
  notes; or
- a review-mode account on the backend that bypasses Google — **not built**, and I would not add an
  authentication bypass without your explicit instruction.

---

## Export compliance

`ITSAppUsesNonExemptEncryption = false` is already in `Info.plist`. The app uses HTTPS only and
implements no cryptography of its own, which is the exemption that key asserts. No CCATS or
year-end report follows from this.

---

## Privacy nutrition label

Answer it to match `ios/Runner/PrivacyInfo.xcprivacy`, which was written from the code:

| Data | Collected | Linked | Tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | App functionality |
| Name | Yes | Yes | No | App functionality |
| User ID | Yes | Yes | No | App functionality |
| Other user content (Claw messages, slips) | Yes | Yes | No | App functionality |
| Other data (Google profile photo URL) | Yes | Yes | No | App functionality |

**Not collected, and verified rather than assumed:**

- **Photos.** The slip scanner opens the photo library, but ML Kit reads the text on-device and only
  that text is sent. There is no multipart upload anywhere in `lib/`.
- **Location, contacts, health, financial info, browsing history, search history.**
- **Anything for tracking.** There is no analytics, crash-reporting, advertising or attribution SDK
  in `pubspec.yaml`, so `NSPrivacyTracking` is false as a matter of fact.

---

## Screenshots

**NEEDS YOU** — capture from the device; I can take them but you should approve what is shown.

Required: 6.9" or 6.5" (1290×2796 or 1242×2688). The connected iPhone 12 Pro Max produces
**1284×2778**, which covers the 6.5" slot.

Suggested five, all real product states already seen working:

1. **Live Centre** — real fixtures with minutes advancing
2. **Match detail** — line-ups and statistics
3. **Claw** — a real answer with the reason for a pick
4. **Convert** — the result screen showing what carried across
5. **Following** — teams being tracked

Capture with `xcrun devicectl device capture screenshot`. Use genuine data. No invented scores,
no mocked-up screens, no claims the app does not deliver.

---

## Build and signing

| | |
|---|---|
| Current artifact | `gameclaw_app/build/ios/iphoneos/Runner.app` — **development** build |
| Signing | Apple Development, free Personal Team `H388VA2V7X` |
| **Submittable** | **No.** A free team issues no distribution certificate and no App Store provisioning profile, so no `.ipa` can be exported or uploaded. |

This is a development build that runs on one registered device for seven days. It is not, and must
not be called, a submission-ready IPA.
