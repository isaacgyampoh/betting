# Operator onboarding

Five bookmakers are implemented and cannot be used. None of them is blocked by code. Each needs
one conversation with the operator, and this is what to ask for and what to send.

Verified 2026-10-16/17. Nothing here was obtained by bypassing access controls, and no further
probing of these services should be done to "check" — the evidence below is sufficient and
repeating it is just traffic they did not ask for.

---

## MSport — being refused

**State.** The integration is finished and correct. Fixtures, markets, event ids, booking-code
read and booking-code issue are all implemented against the same endpoints their own web client
uses, and all of them answer **HTTP 200 from an ordinary connection**.

From our deployed Cloudflare Worker the identical requests return **HTTP 403**, every time, on
every endpoint — while SportyBet and Football.com answer that same Worker without complaint. This
is MSport declining our origin, not an outage and not a bug on our side.

**The ask.** Allow GameClaw's servers to read `www.msport.com/api/gh/` — specifically
`facts-center/query/frontend/*` (fixtures and markets) and `orders/real-sports/order/share/*`
(booking codes). We do not need an account, we place no bets and we take no stakes: GameClaw
reads a booking code, shows the user what is on it, and can produce a new code at a destination.

**Who to ask.** MSport publishes no developer or partner documentation, so this is a business
contact rather than a signup — their Ghana commercial/partnerships team, or the affiliate contact
on msport.com. Ask to be put in touch with whoever owns the public API.

**What they will need from us.** How the allowlist should key:

- **By credential** — an API key or token we send on every request. Best for both sides, and the
  only option that survives our servers moving.
- **By IP** — possible, but Cloudflare Workers do not have a fixed egress address by default. A
  static egress would mean enabling a paid Cloudflare product, which needs your approval first.
  Do not promise them an IP range we do not have.
- **By user-agent or referer** — they may simply be filtering on these. Worth asking, because if
  so the fix is a header they specify, and nothing else changes.

**Done when.** A conversion to MSport returns a booking code that loads back with the same
selections. The capability flags flip by removing one line from `REFUSED_BY_BOOKMAKER` in
`lib/bookmakers/registry.ts`.

---

## 1xBet, 22Bet, Betwinner, PariPesa — booking never worked

These four run the same platform, so they are one conversation held four times, and a single
working answer probably unlocks all of them.

**State.** Fixtures and odds are **verified working** — 50 fixtures with real prices, read live.
Booking is implemented and has never succeeded. A non-wagering round trip on 2026-10-16, using
two Bundesliga fixtures over an hour from kick-off and their own 1X2 prices, with no account and
no stake — the same action their site's own "book" button performs:

| Site | `LiveBet/Open/SaveCoupon` | Read back via `GetCoupon` |
|---|---|---|
| 1xBet | `Success=false`, *"Call failed, please try again later"*, **ErrorCode 161627** | — |
| PariPesa | `Success=true`, returns a code | the code reads back with **zero events in it** |

Both are platform-side refusals of our payload. Our own guard caught both: `createCode` reads a
code back before returning it, so nothing incomplete was ever handed to a user.

**The ask.** The correct request shape for `SaveCoupon`, or an authorised equivalent for creating
a shareable booking code. Specifically: what ErrorCode 161627 means, and why a coupon accepted
with `Success=true` can contain no events. We are sending `GameId`, `Type`, `Coef`, `Param`,
`Kind: 3` (prematch) and the rest of the serializer's fields — if one of those is wrong, that is
the whole blocker.

**Who to ask.** Superseded — see *Is there one coupon API behind 1xBet, 22Bet, Betwinner and
MelBet?* below. The affiliate programme turned out to be the wrong door; the platform supplier is.
Left here because the reasoning was sound at the time: 1xBet Partners looked like the documented
route to API access on this platform — an account manager is assigned, and credentials are issued
through them. What that turns out to issue is reporting access, not sportsbook access.

**Worth saying to them.** We are not placing bets. We generate a booking code that sends a user
to *their* site to stake it, which is the outcome their affiliate programme exists to produce.

**Done when.** A code created through the API reads back with the same selections. Then set
`capabilities.createCode`/`loadCode` to `true` in `lib/bookmakers/1xbet.ts` and its three
siblings, and remove them from `AWAITING_SETUP` in `lib/bookmakers/registry.ts`.

---

## Is there one coupon API behind 1xBet, 22Bet, Betwinner and MelBet?

Researched 2026-10-17. The short answer: **they share an API, but not an authorised one, and no
documentation for it exists anywhere public.** The route to an authorised one is a platform
conversation, and it is probably not the one we assumed.

### What we established ourselves

First-hand, from our own integration rather than from anybody's claim:

| | Public fixtures feed | `SaveCoupon` | Result |
|---|---|---|---|
| 1xBet (`1xbet.com.gh`) | 200, real prices | reached | `Success=false`, **ErrorCode 161627** |
| 22Bet (`22bet.com.gh`) | 200 | implemented, untested | — |
| Betwinner (`betwinner.com.gh`) | 200 | implemented, untested | — |
| PariPesa (`paripesa.top`) | 200 | reached | `Success=true`, code reads back **empty** |
| MelBet (`melbet.com.gh`) | **403 to our origin** | not reached | platform identity unconfirmed |

The first four answer byte-identical endpoint paths — `/service-api/LineFeed/Get1x2_VZip`,
`/service-api/LiveBet/Open/SaveCoupon`, `/service-api/LiveBet/Open/GetCoupon` — and accept the
same `Events` payload, whose field list came from the serializer in their own web bundle rather
than from guesswork. One platform, four skins, and one adapter (`createOnexClient`) serves all
four. That much is settled.

**MelBet could not be checked.** A single read of the same public fixtures feed, the kind our
production adapters make for the other four, returns 403. That is a refusal of our origin, like
MSport's, and it was not worked around. So MelBet is *probably* the same platform — the brand is
named alongside the others by every third-party source — but we have not verified it and should
not write it down as though we had.

### What is not documented, anywhere

- **ErrorCode 161627 has no public meaning.** It appears in no documentation, no forum, no error
  reference. The one site offering a 1xBet "error code reference" has no 16xxxx range at all and
  does not claim to be official.
- **`SaveCoupon` is documented nowhere.** Not by the operators, not by third parties.
- **No operator in this group publishes a developer API.** What is published is affiliate
  *reporting* — clicks, registrations, revenue share. That is a different product and does not
  create or read a booking code.

### Who actually to ask — and a correction

The onboarding note above says to go through 1xBet Partners. That is the affiliate programme, and
on the evidence it is the wrong door: affiliate account managers issue reporting credentials, not
sportsbook API access.

The platform is supplied by a B2B company. **BetB2B** (`bet-b2b.com`, formerly `betb2b.com`)
sells exactly this — "solutions, products and services for sports betting and online casino" — and
multiple third-party platform surveys name it as the software behind 1xBet, 22Bet, Betwinner and
MelBet. Its own site names no brands, so **treat the attribution as unconfirmed**: it is a strong
lead, not a fact. Contact addresses, taken from the site itself: `b2b@bet-b2b.com`, and
`sales@betb2b.com`.

Ask them two things, in this order:

1. Do you supply the platform behind 1xBet, 22Bet, Betwinner and MelBet? (If no, this is the wrong
   company, and the question becomes who does.)
2. Is there an authorised way for a third party to create a booking code on an operator running
   your platform, and read it back? We are not placing bets and take no stakes — we hand a user a
   code to stake on the operator's own site.

### One open question to put to whoever answers

Not a theory to test against their production service — a question for them:

`SaveCoupon` takes a `Coef` per selection, and the platform exposes a separate `UpdateCoupon`
endpoint that "prices a slip". If a coupon is rejected when the submitted coefficient no longer
matches the current price, that would explain a refusal on one site and an empty-but-successful
coupon on another, since the two were read at different moments. **This is a hypothesis and
nothing more.** It will not be tested by firing variations at their production endpoints; it is
written here so it can be asked.

### What this means for the directory today

Nothing changes. All four stay `setup` — implemented, not usable — and MelBet is still not in the
registry, for the reason given below: a fifth adapter that cannot book adds a row to a list and
nothing else. Adding it is a few lines against `createOnexClient` the day booking works.

---

## betPawa and Betway — no route found

Neither publishes a developer API, and the only API material that exists for either is
third-party odds aggregation and affiliate *reporting* feeds. Neither is a booking-code route.

**Before building anything**, establish that an authorised integration exists at all. The
question for each is narrow: *do you offer a way for a third party to create a booking code or
import a slip?* If the answer is no, these stay unsupported and the directory says so — which is
better than a half-integration that cannot be finished.

---

## What not to do

Guess at payload shapes against a live service until something works. These are undocumented
endpoints belonging to someone else; a sequence of experiments against their production systems
is both a breach of their terms and something we would have to keep from them, which is the
clearest possible sign it is the wrong move. Every one of these is a conversation, not a puzzle.

---

## Who is actually licensed in Ghana

From the Gaming Commission of Ghana's own register, read 2026-10-17:
https://www.gamingcommission.gov.gh/licensed-operators/

Thirty-two brands hold a sports betting licence. In the order they matter to us:

| | Brand | Where we stand |
|---|---|---|
| Integrated | SPORTYBET, FOOTBALL.COM | Available, codes issued and read back |
| Refusing us | MSPORT | 403 to our origin; allowlist request above |
| 1xBet platform | 1XBET, 22BET, BETWINNER, **MELBET** | Booking unverified; one conversation covers all four |
| Researched, no route | BETPAWA, BETWAY | No developer API published |
| Not yet investigated | AFRILUCKBET, ALFABET, BANGBET, BC GAME, BETANO, BETBOOKER, BETFOX, BETIKA, BETKING, BINGOBETS, BOLTBET, DBET, GOLDBET, HEROBET, ILOTBET, KBET, KEEDBET, KITOBET, MULASPORT, MYBET.AFRICA, ODIBETS, PREMIER BET, SOCCABET | |

Two things worth acting on:

**MelBet is licensed here and runs the 1xBet platform.** It is not in our registry at all, and it
belongs in the same conversation as 1xBet, 22Bet and Betwinner - one answer about the coupon API
would cover four licensed Ghanaian brands rather than three. Adding the adapter is a few lines
against the existing `createOnexClient`; it is deliberately not done yet, because booking does not
work on that platform and shipping a fifth adapter that cannot book adds nothing but a row in a
list.

**PariPesa is not on the register.** We ship an adapter for it. It is a 1xBet white-label
operating in other markets, so this is not a mistake exactly, but it is the only bookmaker we
carry that no Ghanaian licence covers - and it is worth deciding whether it should be offered to
Ghanaian users at all before any work goes into making it bookable. That is a business call, not
a technical one.

The twenty-three uninvestigated brands are the real expansion surface. The question for each is
the same narrow one that settled betPawa and Betway: *is there an authorised way for a third party
to create a booking code?* Most will answer no. The ones that answer yes are worth building, and
Betano, Betika, BetKing, Premier Bet and Soccabet are the largest of them by presence here.
