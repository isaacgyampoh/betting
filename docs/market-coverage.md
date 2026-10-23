# What markets the bookmakers actually return

Measured, not assumed. Run `scripts/market-probe.ts` to reproduce; every number below came from
one run against the live adapters on **23 October 2026**, reading real fixtures. Nothing here is
from documentation, and nothing was booked.

## The headline

**Football.com is the only source of market data we have.** Across six of today's fixtures from
the five biggest European leagues, SportyBet returned **zero** — not an error, an empty result.
Football.com returned roughly **3,500–3,700 offers per fixture** for four of them.

| Fixture | SportyBet | Football.com |
|---|---|---|
| Ipswich v Nottingham Forest | not listed | 3,674 offers |
| Alaves v Malaga | not listed | 3,537 offers |
| Torino v Monza | not listed | 3,710 offers |
| VfB Stuttgart v Mönchengladbach | not listed | 3,554 offers |
| Stade Brestois 29 v Nice | not listed | **not listed** |

The other seven adapters have no event data at all, which matches `/v1/bookmakers`.

### Two findings that need acting on

1. **SportyBet's `searchEvent` found none of six top-five-league fixtures.** It returns an empty
   list rather than throwing, so nothing reports it as a failure. SportyBet is the bookmaker most
   Ghanaian users hold an account with, and it is one of only two we can book at - if this is real
   rather than a name-matching problem, converting a European slip *to* SportyBet cannot work.
   This needs its own investigation before any market engine is built on it.
2. **Football.com missed one fixture of five.** Coverage is deep but not total, so any feature
   built on it must handle "this fixture has no prices" as an ordinary outcome, not an error.

## What Football.com returns for one fixture

Ipswich v Nottingham Forest, 3,674 offers: 189 across markets our `Market` model already
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
- It rests on **one** bookmaker. That is a single point of failure and should be said out loud in
  the product rather than discovered by a user whose fixture Football.com does not carry.
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
