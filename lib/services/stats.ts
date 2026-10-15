import "server-only";
import type { AuthUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bestMatch, levelFromCompetition, withSquadLevel } from "@/lib/matching/similarity";
import { createApiFootballProvider, StatsPlanLimitError, StatsRateLimitError } from "@/lib/stats/api-football";
import { buildTeamForm } from "@/lib/stats/form";
import { sampleStatsProvider } from "@/lib/stats/sample";
import type { MatchDetail, MatchEvent, MatchSummary, StatsProvider } from "@/lib/stats/types";
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

/**
 * How many fixtures a day's list carries to the browser.
 *
 * A full day is about 1,300 games across every country that plays football, and all of them were
 * being serialised into the page: 894 KB of HTML on a phone, before a single logo. Almost none of
 * it is ever looked at - the leagues people here bet on are at the top, and anything else is a
 * search away. Leagues are kept whole, in priority order, until this is passed.
 */
const MAX_LISTED = 150;

export async function listMatches(
  date: string,
  search?: string,
): Promise<{ groups: LeagueGroup[]; source: StatsProvider["source"]; total: number; shown: number }> {
  const provider = statsProvider();
  const all = await orBusy(provider.fixturesByDate(date));
  await rememberLogos(all);

  // Searching runs here, over the whole day, rather than in the browser over whatever was sent:
  // that is what lets the list be short without putting any game out of reach.
  const needle = search?.trim().toLowerCase();
  const matches = needle
    ? all.filter((m) => [m.home.name, m.away.name, m.league.name, m.league.country].some((v) => v.toLowerCase().includes(needle)))
    : all;

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
  const ranked = [...byLeague.values()]
    .map((g) => ({ ...g, matches: g.matches.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)) }))
    .sort((a, b) => rank(a) - rank(b) || a.league.country.localeCompare(b.league.country) || a.league.name.localeCompare(b.league.name));

  // Whole leagues: half a league's fixtures reads as missing games rather than as a shorter list.
  const groups: LeagueGroup[] = [];
  let shown = 0;
  for (const g of ranked) {
    if (shown >= MAX_LISTED) break;
    groups.push(g);
    shown += g.matches.length;
  }
  return { groups, source: provider.source, total: matches.length, shown };
}


/**
 * @param dateHint kickoff date (YYYY-MM-DD) when known (from a match list or search): the fixture is
 *   then read from that day's cached list instead of costing another API request.
 */
/** How much history we pull per team, and per head-to-head. */
export const FORM_GAMES = 10;
export const H2H_GAMES = 6;

/**
 * `user` is null for background work such as the daily-picks cron: there is nobody to meter, and
 * usage_logs has a foreign key to a real profile, so the metering is skipped rather than faked.
 */
/**
 * What a caller actually needs, and whether this counts as a thing the user did.
 *
 * Researching a slip calls this once per shortlisted pick, and only ever reads the form and the
 * head-to-head - never the table. Fetching the table anyway, metering each pick separately and
 * writing a usage row for each one made eight picks cost about fifty round trips to a database in
 * another region. The build that asked for the research is itself metered and rate-limited, which
 * is what bounds it.
 */
export type DetailOptions = { sections?: ("form" | "h2h" | "standings" | "events")[]; meter?: boolean };
const ALL_SECTIONS: NonNullable<DetailOptions["sections"]> = ["form", "h2h", "standings", "events"];

export async function getMatchDetail(
  user: AuthUser | null,
  fixtureId: number,
  dateHint?: string,
  opts: DetailOptions = {},
): Promise<MatchDetail> {
  const want = new Set(opts.sections ?? ALL_SECTIONS);
  const meter = opts.meter ?? true;
  // Background work is bounded by its own caller, not by a per-user rate limit.
  if (user && meter) await enforceRateLimit({ userId: user.id, kind: "STATS", ...STATS_LIMIT });
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

  const skip = async <T,>(empty: T) => empty;
  const [homeLast, awayLast, h2h, standings, events, coverage] = await Promise.all([
    // Ten games, not five: "9 of 10" is far stronger evidence than "4 of 5", and a home/away split
    // of five leaves only two or three games a side, which says almost nothing.
    want.has("form") ? section("form", () => provider.lastFixtures(match.home.id, FORM_GAMES), []) : skip([] as MatchSummary[]),
    want.has("form") ? section("form", () => provider.lastFixtures(match.away.id, FORM_GAMES), []) : skip([] as MatchSummary[]),
    want.has("h2h") ? section("h2h", () => provider.headToHead(match.home.id, match.away.id, H2H_GAMES), []) : skip([] as MatchSummary[]),
    want.has("standings") ? section("standings", () => provider.standings(match.league.id, match.league.season), null) : skip(null),
    // The timeline is the match centre's spine, so a competition that does not carry events says so
    // rather than showing an empty panel.
    want.has("events") ? section("events", () => provider.events(match.id, match.home.id), []) : skip([] as MatchEvent[]),
    want.has("events") ? provider.coverage(match.league.id, match.league.season).catch(() => null) : skip(null),
  ]);

  if (user && meter) {
    await logUsage({ userId: user.id, kind: "STATS", success: true, meta: { fixtureId, source: provider.source, unavailable: [...unavailable] } });
  }
  return {
    match,
    form: { home: buildTeamForm(match.home, homeLast), away: buildTeamForm(match.away, awayLast) },
    h2h: h2h.filter((m) => m.status === "FINISHED").sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt)),
    standings,
    events,
    coverage,
    unavailable: [...unavailable],
    busy,
    source: provider.source,
  };
}

/**
 * Finds the stats fixture for a bookmaker game (team names differ between sources).
 *
 * `competition` matters more than it looks: some feeds mark an age group or a women's side only in
 * the competition name, so "North Macedonia v Montenegro" in the "U21 UEFA European Championship" is
 * the U21 squad, and matching it against the senior teams finds nothing.
 */
export async function lookupMatch(home: string, away: string, kickoff: Date, competition?: string | null): Promise<MatchSummary | null> {
  const provider = statsProvider();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const dates = new Set([day(kickoff), day(new Date(kickoff.getTime() - 3 * 3600_000)), day(new Date(kickoff.getTime() + 3 * 3600_000))]);
  const [aliases, ...lists] = await Promise.all([getAliasIndex(), ...[...dates].map((d) => provider.fixturesByDate(d))]);
  await rememberLogos(lists.flat());
  const candidates = lists.flat().map((m) => ({ ...m, kickoffAt: new Date(m.kickoffAt), home: m.home.name, away: m.away.name, summary: m }));
  const level = levelFromCompetition(competition);
  const source = { home: withSquadLevel(home, level), away: withSquadLevel(away, level), kickoffAt: kickoff };
  return bestMatch(source, candidates, aliases)?.candidate.summary ?? null;
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
