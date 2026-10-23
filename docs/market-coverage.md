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

### The real gap: names, not coverage

Of six fixtures measured in live mode, both bookmakers listed three. The other two reported "not
listed at SportyBet" - and that was **also** wrong, for a different reason.

SportyBet carries them. In the same session Claw quoted Stuttgart at 1.39 and Brest v Nice both
teams to score at 1.61, both from SportyBet. The bookmaker was never the problem; the name
comparison was:

| Stats provider | SportyBet | Similarity | Threshold 0.8 |
|---|---|---|---|
| Ipswich | Ipswich Town | 0.880 | pass |
| VfB Stuttgart | Stuttgart | 1.000 | pass |
| Borussia Mönchengladbach | Borussia M´gladbach | **0.417** | fail |
| Stade Brestois 29 | Brest | **0.617** | fail |

`bestMatch` scores a fixture as the *minimum* of the two sides, so one abbreviated club name loses
the whole game.

This only affects one direction. Claw starts from a bookmaker's own fixture list and never
compares names across sources, which is why it priced those fixtures happily. The match analyst
starts from the fixture the user tapped - an API-Football record - and has to find that same game
at a bookmaker, so it meets this on every fixture whose names differ.

**Closed on 23 October 2026** with aliases read from the providers' own fixture lists, not from
memory - the SportyBet spelling normalises to `borussia m gladbach`, because the acute accent is
stripped as punctuation and leaves a stray single letter, so that exact form is listed rather than
guessed. Both pairs now score 0.980 through the alias index.

The threshold was deliberately **not** lowered. The same comparison decides which fixture a slip
converts to, and a false match there books a bet on the wrong game; an alias is a claim about two
specific names, a lower threshold is a claim about every pair of names there will ever be.

`tests/matching/cross-source-names.test.ts` pins the fix and, just as importantly, that the
aliases dragged nothing in with them: Dynamo Brest, Borussia Dortmund and Ipswich Town U21 are all
still refused.

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
