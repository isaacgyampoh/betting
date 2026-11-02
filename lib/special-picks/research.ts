import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { statsProvider } from "@/lib/services/stats";
import type { MatchSummary, StatsProvider, TeamStatistics } from "@/lib/stats/types";
import type { Observation } from "@/lib/special-picks/assess";
import type { SpecialMarket, SpecialMarketKind, SpecialSide } from "@/lib/special-picks/markets";

/**
 * The recent counts a selection is judged on.
 *
 * This is the expensive half of the feature and the budget shapes it. Judging one line needs each
 * team's last several matches read individually - the provider has no "average corners" endpoint -
 * so a fixture costs roughly `2 + 2N` provider calls, eighteen at N=8. The free allowance is 1,000
 * a day and the Live Centre already spends about 770, so researching every fixture on a full card
 * would exhaust it before lunch and take the scoreboard down with it.
 *
 * Two things make it affordable:
 *
 *   * **A team's sample is cached, not a fixture's.** Both sides of tomorrow's fixture are likely
 *     to appear again next week, and the same team appears in several candidate markets on the
 *     same day - corners, shots and shots on target all read the same match list. One cache entry
 *     per team per metric serves all of it.
 *   * **A finished match never changes**, so the underlying statistics are cached by the provider
 *     for a day and the aggregate here for twelve hours. The marginal cost falls sharply after the
 *     first run.
 *
 * The caller is still responsible for shortlisting before it gets here. Nothing in this module
 * limits how many teams it is asked about.
 */

const SAMPLE_TTL_MS = 12 * 60 * 60_000;

/** How many recent matches a judgement is built on. */
export const SAMPLE_SIZE = 8;

/** The statistic each market reads, in the shape the provider returns it. */
const FIELD: Record<SpecialMarketKind, keyof TeamStatistics> = {
  CORNERS: "corners",
  SHOTS: "shotsTotal",
  SHOTS_ON_TARGET: "shotsOnGoal",
};

type Sample = { observations: Observation[]; incomplete: number };

/**
 * One team's recent counts for one statistic.
 *
 * `incomplete` is reported rather than hidden: a match the provider has no statistics for is not a
 * zero, and a sample that is mostly gaps must not be presented as evidence. The caller decides
 * what to do with it; the gate in assess.ts rejects anything under six observations outright.
 */
async function teamSample(
  provider: StatsProvider,
  teamId: number,
  kind: SpecialMarketKind,
  /** MATCH reads the combined total of each past match; HOME and AWAY read the team's own count. */
  combined: boolean,
): Promise<Sample> {
  const key = `special:sample:${kind}:${combined ? "match" : "team"}:${teamId}`;
  const hit = await db.statsCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > new Date()) return hit.payload as unknown as Sample;

  const recent = await provider.lastFixtures(teamId, SAMPLE_SIZE).catch((err: unknown) => {
    logger.warn("special.last_fixtures_failed", { teamId, err: String(err) });
    return [] as MatchSummary[];
  });

  const observations: Observation[] = [];
  let incomplete = 0;

  for (const match of recent) {
    // Settled: the statistics of a finished match cannot change, which is what lets the provider
    // cache them for a day rather than seconds.
    const stats = await provider.statistics(match.id, match.home.id, true).catch(() => [] as TeamStatistics[]);
    const [home, away] = stats;
    if (!home || !away) {
      incomplete++;
      continue;
    }

    const field = FIELD[kind];
    const h = home[field] as number | null;
    const a = away[field] as number | null;

    const wasHome = match.home.id === teamId;
    const value = combined ? (h === null || a === null ? null : h + a) : wasHome ? h : a;
    if (value === null || value === undefined) {
      // Not reported for this competition. A gap, never a zero: a corners line judged against
      // zeros would look like a team that never wins a corner.
      incomplete++;
      continue;
    }

    observations.push({ value, kickoffAt: match.kickoffAt, wasHome });
  }

  const sample: Sample = { observations, incomplete };
  try {
    await db.statsCache.upsert({
      where: { key },
      create: { key, endpoint: "special/sample", params: { teamId, kind }, payload: sample as never, expiresAt: new Date(Date.now() + SAMPLE_TTL_MS) },
      update: { payload: sample as never, expiresAt: new Date(Date.now() + SAMPLE_TTL_MS), fetchedAt: new Date() },
    });
  } catch (err) {
    logger.warn("special.sample_cache_failed", { teamId, kind, err: String(err) });
  }
  return sample;
}

export type Research = {
  observations: Observation[];
  /** Matches in the window the provider had no usable figure for. */
  incomplete: number;
  /** Which team's history each half came from, for the published evidence. */
  sources: { home: number; away: number };
};

/**
 * The sample for a market, drawn from the right team's history.
 *
 * A match line is judged on the combined total in *both* teams' recent matches: two separate
 * windows onto the same question, which is the closest thing available to a view of the fixture.
 * A team line is judged on that team's own count only - using the opponent's history for a
 * "home team corners" line would be measuring the wrong thing, which is precisely the mistake the
 * brief warns about when it says a corners selection must rest on corner statistics.
 */
export async function research(
  market: SpecialMarket,
  homeTeamId: number,
  awayTeamId: number,
  provider: StatsProvider = statsProvider(),
): Promise<Research> {
  const combined = market.side === "MATCH";

  if (combined) {
    const [h, a] = await Promise.all([
      teamSample(provider, homeTeamId, market.kind, true),
      teamSample(provider, awayTeamId, market.kind, true),
    ]);
    return {
      observations: [...h.observations, ...a.observations],
      incomplete: h.incomplete + a.incomplete,
      sources: { home: h.observations.length, away: a.observations.length },
    };
  }

  const teamId = market.side === "HOME" ? homeTeamId : awayTeamId;
  const s = await teamSample(provider, teamId, market.kind, false);
  return {
    observations: s.observations,
    incomplete: s.incomplete,
    sources: market.side === "HOME" ? { home: s.observations.length, away: 0 } : { home: 0, away: s.observations.length },
  };
}

/**
 * How much of the window the provider actually covered.
 *
 * A sample of six drawn from sixteen attempts is not the same evidence as six from six, and the
 * difference is invisible in the sample size alone. Below half, the competition plainly does not
 * carry the statistic reliably and the candidate is dropped.
 */
export function coverage(r: Research): number {
  const attempted = r.observations.length + r.incomplete;
  return attempted === 0 ? 0 : r.observations.length / attempted;
}

export const MIN_COVERAGE = 0.5;

/** A one-line summary of the evidence, for the published reason. */
export function describeEvidence(r: Research, line: number, outcome: "OVER" | "UNDER", side: SpecialSide): string {
  const n = r.observations.length;
  const hits = r.observations.filter((o) => (outcome === "OVER" ? o.value > line : o.value < line)).length;
  const mean = n ? r.observations.reduce((a, o) => a + o.value, 0) / n : 0;
  const whose = side === "MATCH" ? "these sides' recent matches" : "that team's recent matches";
  return `${outcome === "OVER" ? "Over" : "Under"} ${line} in ${hits} of ${n} ${
    n === 1 ? "match" : "matches"
  } (${whose}), averaging ${mean.toFixed(1)}.`;
}
