import "server-only";
import type { AuthUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bestMatch, levelFromCompetition, withSquadLevel } from "@/lib/matching/similarity";
import { createApiFootballProvider, StatsPlanLimitError, StatsRateLimitError } from "@/lib/stats/api-football";
import { buildTeamForm } from "@/lib/stats/form";
import { sampleStatsProvider } from "@/lib/stats/sample";
import type { Lineup, MatchDetail, MatchEvent, MatchSummary, StatsProvider, TeamStatistics } from "@/lib/stats/types";
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

// What a day's list leads with, in order.
//
// This was a Ghana list, and GameClaw is not a Ghana product: Ghana Premier League sat second,
// above the Champions League. The order below is the global one - the competitions the most
// people follow, wherever they are - and every pair is checked against the provider's own
// catalogue, because the rank is matched on exact strings and a near-miss is a dead entry that
// silently ranks nothing. "Süper Lig" carries its umlaut, Libertadores is filed under
// "CONMEBOL Libertadores", and the AFC's top tier is "AFC Champions League Elite".
//
// Anything not listed sorts alphabetically by country behind these, which is why an ordinary
// weekday used to open on Albania and Algeria. Widening this list is what fixes that; a real
// popularity signal per competition would fix it better, and is not something the provider gives.
const PRIORITY: [country: string, league: string][] = [
  // European club football, and the continental cups that outrank domestic weekends.
  ["World", "UEFA Champions League"],
  ["England", "Premier League"],
  ["Spain", "La Liga"],
  ["Italy", "Serie A"],
  ["Germany", "Bundesliga"],
  ["France", "Ligue 1"],
  ["World", "UEFA Europa League"],
  ["World", "UEFA Europa Conference League"],
  // National-team football displaces club football whenever it is on.
  ["World", "World Cup"],
  ["World", "Euro Championship"],
  ["World", "UEFA Nations League"],
  ["World", "World Cup - Qualification Europe"],
  // The rest of the world's best-followed domestic leagues.
  ["Brazil", "Serie A"],
  ["Argentina", "Liga Profesional Argentina"],
  ["Portugal", "Primeira Liga"],
  ["Netherlands", "Eredivisie"],
  ["Mexico", "Liga MX"],
  ["Turkey", "Süper Lig"],
  ["Belgium", "Jupiler Pro League"],
  ["Scotland", "Premiership"],
  ["England", "Championship"],
  ["USA", "Major League Soccer"],
  ["Saudi-Arabia", "Pro League"],
  ["Japan", "J1 League"],
  ["South-Korea", "K League 1"],
  // Continental competitions outside Europe.
  ["World", "CONMEBOL Libertadores"],
  ["World", "CONMEBOL Sudamericana"],
  ["World", "AFC Champions League Elite"],
  ["World", "CAF Champions League"],
  ["World", "CONCACAF Champions League"],
  // Africa's larger domestic leagues, in their own right rather than as a home market.
  ["Egypt", "Premier League"],
  ["South-Africa", "Premier Soccer League"],
  ["Nigeria", "NPFL"],
  ["Ghana", "Premier League"],
  // Second tiers people still follow in numbers.
  ["Italy", "Serie B"],
  ["Spain", "Segunda División"],
  ["Germany", "2. Bundesliga"],
];

export type LeagueGroup = { league: MatchSummary["league"]; matches: MatchSummary[] };

/** A fixture picked out of the day, with the reason it was picked. */
export type FeaturedFixture = { match: MatchSummary; reason: string };

/**
 * The handful of fixtures worth leading the day with.
 *
 * Called "Featured", not "Big Games", and that is a deliberate retreat. Significance is not
 * something this data knows: the provider publishes no attendance, no popularity, no derby flag
 * and no importance score, and inventing one would mean dressing a guess as a fact on the screen
 * people trust least. What it does publish is which competition a fixture is in, and the rank
 * order those competitions already have in PRIORITY - which is an editorial judgement we made
 * openly, rather than a measurement we are pretending to have taken.
 *
 * So the rule is small enough to state on the screen: the earliest-kicking fixtures from the
 * highest-ranked competitions playing today, one per competition so a single league cannot take
 * the whole row, and nothing at all from a competition outside the ranked list. A quiet day with
 * no ranked football returns nothing and the section does not appear - which is the honest
 * outcome, and better than filling it with a third tier nobody asked for.
 *
 * It deliberately does not sort by kick-off across competitions: the order is the competition
 * order, so the row reads the same way the list below it does.
 */
export function featuredFixtures(groups: LeagueGroup[], max = 5): FeaturedFixture[] {
  const ranked = groups
    .map((group) => ({
      group,
      rank: PRIORITY.findIndex(([c, l]) => c === group.league.country && l === group.league.name),
    }))
    .filter((entry) => entry.rank !== -1)
    .sort((a, b) => a.rank - b.rank);

  const featured: FeaturedFixture[] = [];
  for (const { group } of ranked) {
    if (featured.length >= max) break;
    // Not yet finished where possible: a result is not something to lead the day with.
    const upcoming = group.matches.filter((m) => m.status !== "FINISHED");
    const match = (upcoming.length ? upcoming : group.matches)[0];
    if (!match) continue;
    // Country first, as everywhere else in the app. Without it the row leads with "Serie A" twice
    // on any day Italy and Brazil both play, which reads as a duplicate rather than two
    // competitions - and "Premier League" is shared by England, Armenia, Egypt and more.
    featured.push({ match, reason: `${group.league.country} · ${group.league.name}` });
  }
  return featured;
}


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
): Promise<{ groups: LeagueGroup[]; featured: FeaturedFixture[]; source: StatsProvider["source"]; total: number; shown: number }> {
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
  return { groups, featured: featuredFixtures(groups), source: provider.source, total: matches.length, shown };
}


/**
 * Which sections a fixture could possibly have yet, as opposed to which we would like it to have.
 *
 * A match that has not kicked off has no timeline and no statistics - not "none that we could
 * fetch", none that exist. Asking anyway costs two upstream calls that come back empty, on
 * two-minute cache entries, for every browse of every scheduled fixture. Measured against
 * production: one match centre costs nine upstream calls and the provider allows three hundred a
 * minute, so those two are the difference between roughly thirty-three and roughly fifty match
 * opens a minute before the product starts refusing itself.
 *
 * Lineups are published about an hour out, so they are worth asking for shortly before kick-off
 * and not before. The window is deliberately generous: an early team sheet should still appear.
 *
 * None of this changes what a screen shows. These sections were already empty; they are now empty
 * without spending the budget the live sections need.
 */
export function sectionsPossibleFor(
  match: Pick<MatchSummary, "status" | "kickoffAt">,
  now = Date.now(),
): { timeline: boolean; lineups: boolean } {
  // Anything that is not still waiting to start can have a timeline: live, finished, and also
  // abandoned or postponed matches, which may carry the events that happened before they stopped.
  const timeline = match.status !== "SCHEDULED";
  const kickoff = Date.parse(match.kickoffAt);
  const minutesAway = Number.isFinite(kickoff) ? (kickoff - now) / 60_000 : 0;
  return { timeline, lineups: timeline || minutesAway <= LINEUP_LEAD_MINUTES };
}

/**
 * @param dateHint kickoff date (YYYY-MM-DD) when known (from a match list or search): the fixture is
 *   then read from that day's cached list instead of costing another API request.
 */
/** How much history we pull per team, and per head-to-head. */
/** How long before kick-off a team sheet is worth asking for. Lineups land about an hour out. */
export const LINEUP_LEAD_MINUTES = 75;

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
export type DetailOptions = {
  sections?: ("form" | "h2h" | "standings" | "events" | "statistics" | "lineups")[];
  meter?: boolean;
};
const ALL_SECTIONS: NonNullable<DetailOptions["sections"]> = [
  "form",
  "h2h",
  "standings",
  "events",
  "statistics",
  "lineups",
];

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

  const { timeline: timelinePossible, lineups: lineupsPossible } = sectionsPossibleFor(match);
  const settled = match.status === "FINISHED" || match.status === "CANCELLED";

  /**
   * Ask the competition what it carries before asking it for anything.
   *
   * API-Football publishes per-season coverage flags, and they are honest: the CAF Champions
   * League reports statistics_fixtures false and standings false, and sure enough every one of
   * those calls comes back 200 with results=0. Three upstream calls, every time anyone opened one
   * of those matches, to be told nothing - on a budget of three hundred a minute shared by the
   * whole product.
   *
   * This call is the cheapest in the set: one league, cached for a day, so after the first open of
   * any fixture in a competition it costs nothing. Fetching it first and letting it decide the
   * rest turns the fan-out from a fixed eight into only what exists.
   *
   * It also changes what the screen can say. A competition that does not carry a timeline is a
   * fact we now know before rendering, so the match centre can say so rather than showing an empty
   * panel that looks like a fault - which is the difference between an app that feels broken
   * outside the big five leagues and one that is simply honest about them.
   */
  const coverage = want.has("events")
    ? await provider.coverage(match.league.id, match.league.season).catch(() => null)
    : null;

  // Absent coverage means unknown, not absent: ask, rather than hide a section on a guess.
  const covers = (flag: keyof NonNullable<typeof coverage>) => coverage?.[flag] ?? true;
  const noteUncovered = (name: MatchDetail["unavailable"][number], covered: boolean) => {
    if (!covered) unavailable.add(name);
    return covered;
  };

  const wantEvents = want.has("events") && noteUncovered("events", covers("events")) && timelinePossible;
  const wantStats = want.has("statistics") && noteUncovered("statistics", covers("statistics")) && timelinePossible;
  const wantLineups = want.has("lineups") && noteUncovered("lineups", covers("lineups")) && lineupsPossible;
  const wantStandings = want.has("standings") && noteUncovered("standings", covers("standings"));

  const [homeLast, awayLast, h2h, standings, events, statistics, lineups] = await Promise.all([
    // Ten games, not five: "9 of 10" is far stronger evidence than "4 of 5", and a home/away split
    // of five leaves only two or three games a side, which says almost nothing.
    want.has("form") ? section("form", () => provider.lastFixtures(match.home.id, FORM_GAMES), []) : skip([] as MatchSummary[]),
    want.has("form") ? section("form", () => provider.lastFixtures(match.away.id, FORM_GAMES), []) : skip([] as MatchSummary[]),
    want.has("h2h") ? section("h2h", () => provider.headToHead(match.home.id, match.away.id, H2H_GAMES), []) : skip([] as MatchSummary[]),
    wantStandings ? section("standings", () => provider.standings(match.league.id, match.league.season), null) : skip(null),
    // `settled` is what lets a finished match's panels be cached for a day rather than two
    // minutes. Nothing about a match that is over can change again.
    wantEvents ? section("events", () => provider.events(match.id, match.home.id, settled), []) : skip([] as MatchEvent[]),
    wantStats ? section("statistics", () => provider.statistics(match.id, match.home.id, settled), []) : skip([] as TeamStatistics[]),
    wantLineups ? section("lineups", () => provider.lineups(match.id, match.home.id, settled), []) : skip([] as Lineup[]),
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
    statistics,
    lineups,
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
