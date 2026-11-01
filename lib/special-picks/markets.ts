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
 * What that rules out, despite the odds existing:
 *
 *   * **Player markets** - and they are the deepest thing on offer: 237 Player Fouls, 234 Player
 *     Fouls Won, 188 Player passes, 153 Player 2nd half shots on target on one fixture. The stats
 *     provider returns an empty `players` array on lower-tier competitions and a populated one on
 *     the top five, so research would silently work for Barcelona and silently fail for everyone
 *     else. Needs its own verification pass before it can be trusted.
 *   * **Tackles.** Priced by the bookmaker, and the provider publishes no tackle statistic at all -
 *     not for a team, not for a player. Nothing to research it with and nothing to settle it from.
 *   * **Team or match fouls.** The provider has fouls; the bookmaker, on the fixture measured,
 *     offers only *Player* Fouls. No team-level line to price against.
 *   * **Cards.** Both sides look available - "Match Cards" is priced, and the provider reports
 *     Yellow Cards - but a cards line is normally settled on yellows *and* reds, and no Red Cards
 *     row appeared in the provider's twenty-five. Settling a cards bet from yellows alone is wrong
 *     exactly when a red is shown, which is the moment the bet matters. Excluded until reds are
 *     confirmed.
 *   * **Halves.** `firstHalf` and `secondHalf` statistics do exist, so H1 markets are reachable
 *     later. Full time only to begin with: one period is one settlement path to get right.
 *
 * Everything here is deliberately narrow. The feature is allowed to publish nothing.
 */
import type { TeamStatistics } from "@/lib/stats/types";

/** The statistic a selection is about. Each one maps to a field we can read after the match. */
export type SpecialMarketKind = "CORNERS" | "SHOTS" | "SHOTS_ON_TARGET";

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

  const field = ({ CORNERS: "corners", SHOTS: "shotsTotal", SHOTS_ON_TARGET: "shotsOnGoal" } as const)[market.kind];
  const h = home[field];
  const a = away[field];

  if (market.side === "HOME") return h ?? null;
  if (market.side === "AWAY") return a ?? null;
  return h === null || h === undefined || a === null || a === undefined ? null : h + a;
}

/** Human label for the published pick, e.g. "Home team corners". */
export function marketLabel(market: SpecialMarket): string {
  const kind = { CORNERS: "corners", SHOTS: "shots", SHOTS_ON_TARGET: "shots on target" }[market.kind];
  const side = { MATCH: "Match", HOME: "Home team", AWAY: "Away team" }[market.side];
  return `${side} ${kind}`;
}

/** Every market this feature can publish, for documentation and for the admin view. */
export const SUPPORTED_MARKETS: readonly SpecialMarket[] = Object.values(BY_NAME).filter(
  (m, i, all) => all.findIndex((o) => o.kind === m.kind && o.side === m.side) === i,
);
