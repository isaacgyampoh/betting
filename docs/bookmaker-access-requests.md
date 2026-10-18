# Access requests, ready to send

Every integration GameClaw cannot complete is blocked on permission, not on code. This file holds
the exact request for each one and says plainly what is being asked for, so sending it is a
decision rather than a drafting exercise.

Nothing here has been sent. Each needs the owner: they are approaches from a named business, and
two of them are contracts.

**Status as of 2026-10-18.** Working integrations: SportyBet Ghana and Football.com Ghana, both
live-verified with a real code created and read back the same day.

---

## 1. MSport — the block is theirs to lift

**Blocker.** MSport sits behind Cloudflare. Its WAF answers `403 Attention Required` to our
requests — first from the deployed Worker, and as of 18 October 2026 from an ordinary connection
too, so the block has widened rather than being specific to our hosting.

**Why this is a request and not a bug.** The integration is finished and was working before the
block: endpoints, market mapping and booking format were all verified. Nothing on our side needs
fixing, and nothing on our side *can* fix it. Working around a WAF would breach their terms and
would have to be kept secret from them, which is a reliable sign it is the wrong move.

**What to ask for:** an allowlist entry for our server egress, or an official integration.

> Subject: GameClaw — request to allowlist our server for booking-code integration
>
> Hello,
>
> I run GameClaw, a Ghanaian app that helps bettors move a booking code from one bookmaker to
> another. We have a completed MSport integration — fixture lookup, market mapping and booking-code
> creation — built against your public endpoints and verified working earlier this year.
>
> Since then our requests have been answered with HTTP 403 by Cloudflare. We have not attempted to
> work around it, and we will not: we would rather have your permission than your traffic.
>
> We are asking for one of:
>
> - an allowlist entry for our server's egress address, or
> - an official or partner integration route, if one exists.
>
> We send a low, predictable volume: one fixture lookup and one booking-code creation per user
> conversion. We place no bets and hold no customer funds. Every converted slip sends a customer to
> MSport with a ready-made coupon, so the traffic is commercial rather than extractive.
>
> Happy to sign whatever terms this needs, and to share our server addresses and request patterns.

**What it unlocks:** MSport Ghana and MSport Nigeria, both as source and destination.

---

## 2. 1xBet platform (1xBet, 22Bet, Betwinner, PariPesa) — booking needs an agreement

**Blocker.** Fixtures and odds work and are verified live. Booking does not:

- **1xBet** — `SaveCoupon` returns `Success=false`, "Call failed, please try again later",
  `ErrorCode 161627`.
- **PariPesa** — `SaveCoupon` returns a code, and `GetCoupon` then reads that code back with **zero
  events**. The coupon is created empty.

Both are platform-side refusals of a valid-looking payload, not transport errors. Our own guard
caught both: `createCode` reads a code back before returning it, so nothing incomplete ever reached
a user.

**There is no documented error to look up.** `SaveCoupon` is an undocumented internal endpoint;
there is no published 1xBet B2B API or developer programme, and the only third-party vendors sell
*odds* data, which cannot book. Guessing at the payload would mean experimenting against somebody
else's production service.

**What to ask for:** a documented booking API, or confirmation that coupon creation requires an
operator agreement.

> Subject: GameClaw — booking-code API access for the 1xBet platform
>
> Hello,
>
> I run GameClaw, a Ghanaian betting-slip conversion app. We read fixtures and odds from your
> public feed successfully and would like to create booking codes for customers who choose your
> brand as their destination.
>
> Coupon creation is refused: `SaveCoupon` returns ErrorCode 161627 on 1xBet, and on PariPesa it
> returns a code whose coupon reads back with no events. We have stopped there rather than
> experiment against your production service.
>
> Could you tell us which is the case:
>
> - a documented or partner booking API we should be using instead, or
> - an operator agreement that coupon creation requires?
>
> We would rather integrate the way you intend. Each converted slip sends a customer to you with a
> ready-made coupon.

**What it unlocks:** four brands across up to thirteen markets, by the operators' own country
lists — the single largest coverage gain available.

---

## 3. Betway and betPawa — no authorised route found

**Blocker.** Adapters exist, written against a booking-code format that was never confirmed against
the real service, and no documented API has been found to confirm it against. They stay
`researching` and are shown to users as not supported.

**What to ask for:** whether a booking-code or affiliate integration exists.

> Subject: GameClaw — is there an integration route for booking codes?
>
> Hello,
>
> I run GameClaw, a Ghanaian betting-slip conversion app. Customers ask to convert slips to
> [Betway / betPawa], and we would like to support it properly.
>
> Is there a documented or partner API for reading and creating booking codes? We have not built
> against undocumented endpoints and would rather do this with your agreement.

**What it unlocks:** betPawa is present in at least nine African markets by its own country sites,
so the coverage gain is large if a route exists.

---

## 4. Conversion providers — a commercial decision, not a technical one

Both providers are real and gated as documented. Both claim **every operator we are blocked on**:
MSport, Betway, betPawa, 1xBet, 22Bet, Betwinner and PariPesa.

| | Convat | Betloy |
|---|---|---|
| Entry | 30-day evaluation, free credits, **signed agreement** | **Free forever**, 10 units/month, no card |
| Production | Prepaid monthly, quoted on request | NGN 10,000/mo (100 units) · NGN 75,000/mo (2,000+) |
| Observed | `/api/health` → 200, four engines healthy | `/api/v1/bookmakers` → 401 `AUTH_REQUIRED` |
| Blocker | A contract — needs the owner | An account in the owner's name |

Neither was signed up for. Betloy's free tier is the cheaper experiment; Convat names MSport and
Football.com explicitly and is the more interesting one if the API list matches its converter.

**Verify before committing** — written down now, while nothing is at stake. Full lists are in
`lib/bookmakers/catalogue/providers.ts`; the short version:

- Does the **API's** bookmaker list match the consumer converter's? Convat's `/api` page quotes 50
  sources and 56 destinations, which is not the same set as its dropdowns.
- Is **Ghana** actually covered? Neither provider states supported countries for its API.
- Does a created destination code **read back with the same selections and lines**? This is the
  exact failure PariPesa already showed us, and it is the only test that matters.
- Betloy's published rate limits **contradict each other** between its table and its FAQ.
- Both list identical "convert from" and "convert to" sets. Perfectly symmetric capability across
  sixty operators is unusual; test it on the ones we care about rather than assuming it.

**A standing caution.** Routing conversions through a third party means a provider outage becomes a
GameClaw outage, and it puts another company between our users and their booking codes. Worth it
for operators we cannot reach directly; not worth it for SportyBet and Football.com, which we
already do better ourselves.
