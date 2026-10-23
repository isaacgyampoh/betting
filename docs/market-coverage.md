# What markets the bookmakers actually return

Measured, not assumed. Run `scripts/market-probe.ts` to reproduce; every number below came from
one run against the live adapters on **23 October 2026**, reading real fixtures. Nothing here is
from documentation, and nothing was booked.

## The headline

**Both live bookmakers carry deep markets, and they carry nearly the same ones.** SportyBet and
Football.com both run on the Hopegaming platform, which shows: roughly **3,500-4,300 offers per
fixture** each, with near-identical market sets.

| Fixture | SportyBet | Football.com |
|---|---|---|
| Ipswich v Nottingham Forest | 4,275 offers | 3,681 offers |
| Alaves v Malaga | 3,572 offers | 3,534 offers |
| Torino v Monza | 3,721 offers | 3,710 offers |

The other seven adapters return no event data, which matches `/v1/bookmakers`.

### A correction, recorded because it nearly cost a day

An earlier run of this probe reported that **SportyBet carried none of these fixtures**, and that
conversion to SportyBet might therefore be broken for European football. That was false. The probe
set `SPORTYBET_MODE ??= "live"`, and `.env.local` already sets it to `mock` for local development,
so `??=` left the mock adapter in place and the probe measured a fixture generator rather than a
bookmaker. The probe now forces the mode instead of defaulting it.

The lesson is in the shape of the bug, not the typo: a mock that returns plausible-looking empty
results is indistinguishable from a live integration that is failing, and the thing being measured
has to be pinned rather than assumed. Production sets `SPORTYBET_MODE: live` in both `render.yaml`
and `wrangler.jsonc`; it was only ever local configuration.

### What does need handling

Coverage is deep but not total - an earlier run found neither bookmaker listing Stade Brestois 29
v Nice. Any feature built on this must treat "this fixture has no prices" as an ordinary outcome,
not an error.

## What one fixture looks like

Ipswich v Nottingham Forest on Football.com, 3,674 offers (SportyBet's set is near-identical): 189 across markets our `Market` model already
understands, and **3,485 across 278 distinct market types it does not**.

### Already modelled

| Market | Offers |
|---|---|
| `OVER_UNDER` | 46 |
| `HANDICAP` | 39 |
| `TEAM_OVER_UNDER` | 38 |
| `ASIAN_HANDICAP` | 30 |
| `MATCH_RESULT` | 9 |
| `DOUBLE_CHANCE` | 9 |
| `BTTS` / `DRAW_NO_BET` / `ODD_EVEN` | 6 each |

### Not modelled — the 278

| Group | Types | Offers | Examples |
|---|---|---|---|
| Player | 28 | 1,740 | Player passes (198), tackles (185), shots on goal (180), shots (160), fouls (142), goals (108) |
| Halves | 67 | 449 | Halftime/Fulltime & Total (66), HT/FT Correct Score (46), 1st/2nd Half Correct Score |
| Cards | 22 | 127 | Total Booking Points, Exact Bookings, Bookings Over/Under, team totals, 1st-half variants |
| Corners | 22 | 112 | Corners Over/Under, Home/Away Team Total Corners, Corner Handicap, 1st-half variants |
| Other | 138 | 1,049 | Total Goals from 1 to X min (124), Match Result after X Minutes (45), goalscorer markets |

So **corners, cards and player markets are all genuinely available** - the question the probe was
written to answer. They are available from one bookmaker, for most but not all fixtures, and only
as raw market names: our model does not describe any of them, so an engine would read `raw` and
would have to be written against these names.

## What this means for a market engine

- It can be built. Corners, cards, halves and player markets are real, priced and plentiful.
- It rests on **two** bookmakers that share a platform, so their market vocabulary is one
  vocabulary with one set of failure modes - redundancy in name more than in substance.
- It cannot use our `Market` model for any of it. Either the model grows to cover these, or the
  engine reads raw names - and raw names are a bookmaker's private vocabulary that can change
  without notice, so whatever reads them has to fail closed.
- Nothing here says a price is *good*. These are the markets that exist; judging them needs the
  evidence pipeline, not more market types.

## Reproducing

```bash
N=1 npx tsx --tsconfig tsconfig.scripts.json scripts/market-probe.ts [YYYY-MM-DD]
```

Fixtures come from the deployed API over HTTP. The bookmaker adapters run locally without a
database - their cache is explicitly an optimisation, not a dependency - so the only noise is a
`bookmaker.cache_write_failed` warning per request, which is expected off-platform.
