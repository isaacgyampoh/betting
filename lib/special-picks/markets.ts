/**
 * Which specialist markets Daily Special Picks is allowed to publish, and why each one qualifies.
 *
 * A market earns a place here only by passing three tests, all of which have to hold or the
 * selection cannot honestly be published:
 *
 *   1. **A bookmaker prices it.** Measured, not assumed - `scripts/market-probe.ts` against a live
 *      fixture on 1 November 2026 returned 3,696 offers across 175 distinct raw market names from
 *      SportyBet, with Football.com near-identical. docs/market-coverage.md has the survey.
 *   2. **We can research it.** The statistic has to exist in the stats provider's per-match data,
 *      or there is nothing to base a selection on but a hunch.
 *   3. **We can settle it.** The same statistic has to be readable once the match is over. A
 *      selection nobody can grade is worse than no selection: it sits "pending" for ever and
 *      quietly keeps itself out of the published record.
 *
 * What that rules out, and why - every line below is a measurement, not a guess. The bookmaker
 * side is `scripts/market-probe.ts`; the provider side is six finished, well-covered fixtures on
 * 4 November 2026 (two Serie A, Championship, two Champions League, Ligue 1).
 *
 *   * **Throw-ins.** Priced well - "Throw-Ins Over/Under" on 14 offers, with team variants - and
 *     GOAL returns a `Throw In` row. It is not populated: three of the six read 0/0 while the
 *     other three read 19/17, 13/19 and 17/15. A real match has throw-ins, so a reported 0 is a
 *     gap wearing a number, and settling an over against it loses a bet that won.
 *   * **Tackles, clearances, blocks, interceptions.** GOAL reported none of them in any of the
 *     six. Tackles are priced, thinly (2 offers); the rest are not priced either. Nothing to
 *     research with and nothing to settle from.
 *   * **Goalkeeper saves, passes.** GOAL has both on all six. The bookmaker prices them only as
 *     *player* markets - "Player Saves" (28 offers), "Player passes" (372) - and there is no team
 *     line to price against.
 *   * **Cards and bookings.** The closest call, and still out. The bookmaker prices them properly
 *     ("Bookings - Over/Under", team totals, "Match Cards"), and GOAL gives Yellow Cards on all
 *     six. Red Cards appears on only two - the two where a red was shown - so "no row" has to be
 *     read as zero, and nothing can confirm that: the events feed carries goals and nothing else
 *     on these fixtures, so it cannot corroborate a card either way. A cards line settled one red
 *     short flips the result, silently and permanently, exactly when the bet mattered. It becomes
 *     available the moment reds can be corroborated.
 *   * **Player markets** - the deepest thing on offer: 372 Player passes, 237 Player Fouls, 163
 *     Player shots on one fixture. GOAL returns an empty `players` array on lower-tier
 *     competitions and a populated one on the top five, so research would silently work for
 *     Barcelona and silently fail for everyone else. Expected participation is not available
 *     either, and the brief requires it.
 *   * **Halves.** `firstHalf` and `secondHalf` statistics exist, so H1 markets are reachable
 *     later. Full time only to begin with: one period is one settlement path to get right.
 *
 * Everything here is deliberately narrow. The feature is allowed to publish nothing.
 */
import type { TeamStatistics } from "@/lib/stats/types";

/** The statistic a selection is about. Each one maps to a field we can read after the match. */
export type SpecialMarketKind = "CORNERS" | "SHOTS" | "SHOTS_ON_TARGET" | "FOULS" | "OFFSIDES";

/** Whose count the line applies to. */
export type SpecialSide = "MATCH" | "HOME" | "AWAY";

export type SpecialMarket = {
  kind: SpecialMarketKind;
  side: SpecialSide;
  /** Full time only for now; see the note above. */
  period: "FT";
};

/**
 * Markets that may never appear, whatever else happens.
 *
 * The brief is explicit that the daily quota must not be filled with ordinary match-result or
 * goals predictions, and the honest failure mode is not malice but convenience: those markets are
 * the easiest to find odds for and the easiest to settle, so a tired ranking function will drift
 * towards them. This list is checked on the way in and again on the way out.
 */
const FORBIDDEN = [
  /\b1x2\b/i,
  /match\s*result/i,
  /double\s*chance/i,
  /draw\s*no\s*bet/i,
  /both\s*teams\s*to\s*score/i,
  /\bgg\s*\/?\s*ng\b/i,
  /correct\s*score/i,
  /half\s*time\s*\/\s*full\s*time/i,
  /\bht\s*\/\s*ft\b/i,
  /clean\s*sheet/i,
  /win\s*to\s*nil/i,
  /\bhandicap\b/i,
  /to\s*win\b/i,
];

/** True for any market this feature must never publish, regardless of the table below. */
export function isForbiddenMarket(rawName: string): boolean {
  return FORBIDDEN.some((re) => re.test(rawName));
}

/**
 * Raw bookmaker names, mapped to what they mean.
 *
 * Both live bookmakers run the Hopegaming platform and still spell these differently - SportyBet
 * says "Corners - Over/Under" and "Home Shots on Target Over/Under" where Football.com says
 * "Corners O/U" and "Home Team Shots on Target O/U". Both spellings were read off the same fixture
 * in the same probe run, so both are listed rather than normalised with a clever regex: a raw
 * market name is a bookmaker's private vocabulary that can change without notice, and an exact
 * list fails closed when it does. A name not on this list is simply not published.
 */
const BY_NAME: Record<string, SpecialMarket> = {
  // --- corners ---
  "corners - over/under": { kind: "CORNERS", side: "MATCH", period: "FT" },
  "corners o/u": { kind: "CORNERS", side: "MATCH", period: "FT" },
  "corners over/under": { kind: "CORNERS", side: "MATCH", period: "FT" },
  "home team total corners": { kind: "CORNERS", side: "HOME", period: "FT" },
  "away team total corners": { kind: "CORNERS", side: "AWAY", period: "FT" },

  // --- shots ---
  "shots over/under": { kind: "SHOTS", side: "MATCH", period: "FT" },
  "home team shots over/under": { kind: "SHOTS", side: "HOME", period: "FT" },
  "away team shots over/under": { kind: "SHOTS", side: "AWAY", period: "FT" },

  // --- shots on target ---
  "shots on target over/under": { kind: "SHOTS_ON_TARGET", side: "MATCH", period: "FT" },
  "home shots on target over/under": { kind: "SHOTS_ON_TARGET", side: "HOME", period: "FT" },
  "away shots on target over/under": { kind: "SHOTS_ON_TARGET", side: "AWAY", period: "FT" },
  "home team shots on target o/u": { kind: "SHOTS_ON_TARGET", side: "HOME", period: "FT" },
  "away team shots on target o/u": { kind: "SHOTS_ON_TARGET", side: "AWAY", period: "FT" },

  // --- fouls ---
  "fouls over/under": { kind: "FOULS", side: "MATCH", period: "FT" },
  "home team fouls over/under": { kind: "FOULS", side: "HOME", period: "FT" },
  "away team fouls over/under": { kind: "FOULS", side: "AWAY", period: "FT" },

  // --- offsides ---
  "offsides over/under": { kind: "OFFSIDES", side: "MATCH", period: "FT" },
  "home offsides over/under": { kind: "OFFSIDES", side: "HOME", period: "FT" },
  "away offsides over/under": { kind: "OFFSIDES", side: "AWAY", period: "FT" },
  "home team offsides over/under": { kind: "OFFSIDES", side: "HOME", period: "FT" },
  "away team offsides over/under": { kind: "OFFSIDES", side: "AWAY", period: "FT" },
};

/**
 * The market a raw bookmaker name describes, or null.
 *
 * Null is the normal answer. Of 175 distinct names on one fixture, thirteen are listed here.
 */
export function parseSpecialMarket(rawName: string): SpecialMarket | null {
  const name = rawName.trim().toLowerCase().replace(/\s+/g, " ");
  if (isForbiddenMarket(name)) return null;
  return BY_NAME[name] ?? null;
}

/**
 * The number a selection is graded against, read from the match statistics we already map.
 *
 * Returns null when the statistic is missing rather than treating it as zero. A corners line
 * settled against a null read as 0 would mark every "over" as lost, which is the worst possible
 * way to be wrong: silent, plausible, and permanent in the published record.
 */
export function actualFor(market: SpecialMarket, stats: TeamStatistics[]): number | null {
  const [home, away] = stats;
  if (!home || !away) return null;

  const field = (
    { CORNERS: "corners", SHOTS: "shotsTotal", SHOTS_ON_TARGET: "shotsOnGoal", FOULS: "fouls", OFFSIDES: "offsides" } as const
  )[market.kind];
  const h = home[field];
  const a = away[field];

  if (market.side === "HOME") return h ?? null;
  if (market.side === "AWAY") return a ?? null;
  return h === null || h === undefined || a === null || a === undefined ? null : h + a;
}

/** Human label for the published pick, e.g. "Home team corners". */
export function marketLabel(market: SpecialMarket): string {
  const kind = {
    CORNERS: "corners",
    SHOTS: "shots",
    SHOTS_ON_TARGET: "shots on target",
    FOULS: "fouls",
    OFFSIDES: "offsides",
  }[market.kind];
  const side = { MATCH: "Match", HOME: "Home team", AWAY: "Away team" }[market.side];
  return `${side} ${kind}`;
}

/** Every market this feature can publish, for documentation and for the admin view. */
export const SUPPORTED_MARKETS: readonly SpecialMarket[] = Object.values(BY_NAME).filter(
  (m, i, all) => all.findIndex((o) => o.kind === m.kind && o.side === m.side) === i,
);
