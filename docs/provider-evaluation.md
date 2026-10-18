# Provider evaluation: the smallest test that would tell us something

Nothing here has been run against a provider. No account exists, no key exists, no agreement has
been signed. This is the plan to execute once one does, written now so the criteria are fixed
before anyone has an incentive to move them.

## What we already know without an account

| | Convat | Betloy |
|---|---|---|
| Service is real | `/api/health` → 200, four engines healthy | `/api/v1/bookmakers` → 401 `AUTH_REQUIRED` |
| Documented endpoint | `POST {base}/v1/convert` | not published without a key |
| Auth | `Authorization: Bearer`, `Idempotency-Key` | Bearer token from dashboard |
| Charging | 1 credit per conversion **that returns a code**; failures, previews, retries free | 1 credit per API call |
| Timeout guidance | 60s client timeout; a slow bookmaker takes ~1 min | not published |
| Rate limits | **not published** | **published twice, contradicting itself** |
| Data retention | **not published** | **not published** |
| Entry | 30-day evaluation, free credits, **signed agreement** | **free forever**, 10 units/month, no card |
| Production | prepaid monthly, quoted on request | ₦10,000/mo (100 units) · ₦75,000/mo (2,000+) |

### The finding that matters most

**Convat lists SportyBet as a destination only.** It appears in the "convert to" column and not in
"convert from", so Convat cannot read a SportyBet code.

GameClaw's main source is SportyBet Ghana. So Convat would add **inbound** coverage — a bookmaker
we cannot read, converted *into* SportyBet — and nothing outbound. That is still valuable, because
reading MSport, Betway, betPawa and the 1xBet family is exactly what we cannot do. But it is half
of what the marketing page implies, and it changes what the evaluation should test first.

Betloy lists identical "convert from" and "convert to" sets, including SportyBet Ghana as both.
Perfectly symmetric capability across sixty operators is unusual, so that claim is the first thing
to test rather than the thing to rely on.

### The unknown that could make a conversion silently wrong

The documented Convat request body is `{ source, target, code }` — **no country field**. GameClaw
addresses bookmakers as brand-and-country because SportyBet Ghana and SportyBet Nigeria are
different fixtures at different prices. A Ghana slip converted into a Nigeria code would name the
right teams at the wrong country's prices and look entirely correct on screen.

Until this is answered, `createConvatRoute().supports()` refuses any pair whose countries differ.
That is deliberately conservative and should stay until Convat states how a market is chosen.

## The minimal matrix

Eight conversions. Enough to answer every question that decides the commercial case, few enough to
fit inside Betloy's free tier (10 units/month) without paying anyone.

Run each one, record the destination code, then **read that code back at the destination bookmaker
with our own adapter** and compare.

| # | Source | Destination | What it answers | Pass condition |
|---|---|---|---|---|
| 1 | MSport GH | SportyBet GH | The headline: can a provider read what we cannot? | Code reads back with the same legs |
| 2 | Betway GH | SportyBet GH | A second blocked source | Same |
| 3 | betPawa GH | SportyBet GH | A third blocked source | Same |
| 4 | 1xBet GH | SportyBet GH | The family we are refused by | Same |
| 5 | SportyBet GH | MSport GH | Outbound — expected to fail on Convat | Documented either way |
| 6 | SportyBet GH | SportyBet NG | Country handling | Must refuse, or produce a GH-priced code |
| 7 | *(expired code)* | SportyBet GH | Error honesty | A clear error, never a code |
| 8 | *(repeat of #1, same Idempotency-Key)* | | Idempotency and double-charging | Same result, one credit |

**Readback is the test, not the 200.** A provider returning `targetCode` proves it returned a
string. We already have the counter-example: PariPesa's own `SaveCoupon` returns a code whose
coupon reads back with zero events. Case 1 is not a pass until the SportyBet adapter loads that
code and finds the same selections.

### What would count as a pass overall

- At least **two** blocked sources (cases 1–4) convert and read back with matching legs.
- Case 7 produces an honest error.
- Case 8 does not charge twice and returns the first result.
- Case 6 either refuses or demonstrably respects country.

Fewer than two working blocked sources means the provider adds nothing we cannot already do, and
the subscription should not be bought.

### What is not being tested, and why

No bets are placed and no funds are spent. A booking code is a shareable list of picks; creating
one costs nothing at the bookmaker. If a provider ever requires a funded account to issue a code,
stop and raise it — that is a different commercial proposition from the one described here.

## Status after this evaluation

Passing cases move the relevant catalogue entries from `awaiting-authorisation` to
`partially-supported`, with `limits` naming the directions that do not work.

**Nothing becomes `live-verified` through a provider on the strength of a 200.** That status means
a real destination code created and read back with equivalent selections — which is precisely what
the matrix above measures, so a passing case earns it honestly or not at all.
