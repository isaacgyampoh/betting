import "server-only";
import type { AuthUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bestMatch } from "@/lib/matching/similarity";
import { createApiFootballProvider, StatsPlanLimitError, StatsRateLimitError } from "@/lib/stats/api-football";
import { buildTeamForm } from "@/lib/stats/form";
import { sampleStatsProvider } from "@/lib/stats/sample";
import type { MatchDetail, MatchSummary, StatsProvider } from "@/lib/stats/types";
import { getAliasIndex } from "@/lib/services/events";
import { rememberLogos } from "@/lib/services/team-logos";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";

export const STATS_LIMIT = { limit: 200, windowMs: 60 * 60_000 };

let cachedProvider: StatsProvider | null = null;

export function statsProvider(): StatsProvider {
  if (cachedProvider) return cachedProvider;
  const { STATS_MODE, API_FOOTBALL_KEY } = env();
  const live = STATS_MODE === "live" || (STATS_MODE === "auto" && !!API_FOOTBALL_KEY);
  if (live && !API_FOOTBALL_KEY) throw new AppError("STATS_UNAVAILABLE", "Match stats aren't configured yet.");
  cachedProvider = live ? createApiFootballProvider(API_FOOTBALL_KEY!) : sampleStatsProvider;
  return cachedProvider;
}

// Leagues Ghanaian bettors care about most, shown first.
const PRIORITY: [country: string, league: string][] = [
  ["England", "Premier League"],
  ["Ghana", "Premier League"],
  ["Spain", "La Liga"],
  ["Italy", "Serie A"],
  ["Germany", "Bundesliga"],
  ["France", "Ligue 1"],
  ["World", "UEFA Champions League"],
  ["World", "UEFA Europa League"],
  ["England", "Championship"],
  ["Netherlands", "Eredivisie"],
  ["Portugal", "Primeira Liga"],
];

export type LeagueGroup = { league: MatchSummary["league"]; matches: MatchSummary[] };

const BUSY_MESSAGE = "Match stats are busy right now. Please try again in a minute.";

async function orBusy<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof StatsRateLimitError) throw new AppError("STATS_UNAVAILABLE", BUSY_MESSAGE, { cause: err });
    if (err instanceof StatsPlanLimitError) throw new AppError("STATS_UNAVAILABLE", "Stats for that date aren't available on our current plan.", { cause: err });
    throw err;
  }
}

export async function listMatches(date: string): Promise<{ groups: LeagueGroup[]; source: StatsProvider["source"] }> {
  const provider = statsProvider();
  const matches = await orBusy(provider.fixturesByDate(date));
  await rememberLogos(matches);
  const byLeague = new Map<number, LeagueGroup>();
  for (const m of matches) {
    const g = byLeague.get(m.league.id) ?? { league: m.league, matches: [] };
    g.matches.push(m);
    byLeague.set(m.league.id, g);
  }
  const rank = (g: LeagueGroup) => {
    const i = PRIORITY.findIndex(([c, l]) => c === g.league.country && l === g.league.name);
    return i === -1 ? PRIORITY.length : i;
  };
  const groups = [...byLeague.values()]
    .map((g) => ({ ...g, matches: g.matches.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)) }))
    .sort((a, b) => rank(a) - rank(b) || a.league.country.localeCompare(b.league.country) || a.league.name.localeCompare(b.league.name));
  return { groups, source: provider.source };
}

/**
 * @param dateHint kickoff date (YYYY-MM-DD) when known (from a match list or search): the fixture is
 *   then read from that day's cached list instead of costing another API request.
 */
export async function getMatchDetail(user: AuthUser, fixtureId: number, dateHint?: string): Promise<MatchDetail> {
  await enforceRateLimit({ userId: user.id, kind: "STATS", ...STATS_LIMIT });
  const provider = statsProvider();
  const fromDay =
    dateHint && /^\d{4}-\d{2}-\d{2}$/.test(dateHint)
      ? (await provider.fixturesByDate(dateHint).catch(() => [])).find((m) => m.id === fixtureId)
      : undefined;
  const match = fromDay ?? (await orBusy(provider.fixture(fixtureId)));
  if (!match) throw new AppError("NOT_FOUND", "We couldn't find that match.");

  // Each section is optional: a plan limit marks it unavailable instead of failing the page.
  const unavailable = new Set<MatchDetail["unavailable"][number]>();
  let busy = false;
  const section = async <T,>(name: MatchDetail["unavailable"][number], load: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await load();
    } catch (err) {
      if (err instanceof StatsPlanLimitError) {
        unavailable.add(name);
        return empty;
      }
      if (err instanceof StatsRateLimitError) {
        busy = true;
        return empty;
      }
      if (name === "standings") {
        // Cups and friendlies have no table; a failure here shouldn't hide the rest.
        logger.warn("stats.standings_failed", { leagueId: match.league.id, err });
        return empty;
      }
      throw err;
    }
  };

  const [homeLast, awayLast, h2h, standings] = await Promise.all([
    section("form", () => provider.lastFixtures(match.home.id, 5), []),
    section("form", () => provider.lastFixtures(match.away.id, 5), []),
    section("h2h", () => provider.headToHead(match.home.id, match.away.id, 5), []),
    section("standings", () => provider.standings(match.league.id, match.league.season), null),
  ]);

  await logUsage({ userId: user.id, kind: "STATS", success: true, meta: { fixtureId, source: provider.source, unavailable: [...unavailable] } });
  return {
    match,
    form: { home: buildTeamForm(match.home, homeLast), away: buildTeamForm(match.away, awayLast) },
    h2h: h2h.filter((m) => m.status === "FINISHED").sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt)),
    standings,
    unavailable: [...unavailable],
    busy,
    source: provider.source,
  };
}

/** Finds the stats fixture for a bookmaker game (team names differ between sources). */
export async function lookupMatch(home: string, away: string, kickoff: Date): Promise<MatchSummary | null> {
  const provider = statsProvider();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const dates = new Set([day(kickoff), day(new Date(kickoff.getTime() - 3 * 3600_000)), day(new Date(kickoff.getTime() + 3 * 3600_000))]);
  const [aliases, ...lists] = await Promise.all([getAliasIndex(), ...[...dates].map((d) => provider.fixturesByDate(d))]);
  await rememberLogos(lists.flat());
  const candidates = lists.flat().map((m) => ({ ...m, kickoffAt: new Date(m.kickoffAt), home: m.home.name, away: m.away.name, summary: m }));
  return bestMatch({ home, away, kickoffAt: kickoff }, candidates, aliases)?.candidate.summary ?? null;
}

/** Upcoming (and today's) matches involving the named team(s), across the next few days. */
export async function searchMatches(team: string, opponent?: string, days = 4): Promise<MatchSummary[]> {
  const { teamSimilarity } = await import("@/lib/matching/similarity");
  const provider = statsProvider();
  const aliases = await getAliasIndex();
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() + (i - 1) * 86_400_000).toISOString().slice(0, 10));
  const lists = await Promise.all(dates.map((d) => provider.fixturesByDate(d)));
  await rememberLogos(lists.flat());
  const hits = (m: MatchSummary, name: string) => Math.max(teamSimilarity(name, m.home.name, aliases), teamSimilarity(name, m.away.name, aliases)) >= 0.8;
  return lists
    .flat()
    .filter((m) => hits(m, team) && (!opponent || hits(m, opponent)))
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
    .slice(0, 5);
}
