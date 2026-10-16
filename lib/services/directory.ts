import "server-only";
import type { AuthUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { buildTeamForm } from "@/lib/stats/form";
import type {
  CompetitionSummary,
  MatchSummary,
  SquadPlayer,
  StandingRow,
  StatsProvider,
  TeamForm,
  TeamProfile,
} from "@/lib/stats/types";
import { FORM_GAMES, statsProvider, STATS_LIMIT } from "@/lib/services/stats";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";

/** How many of each list a team page carries. Enough to be useful, short enough to render. */
const TEAM_RECENT = FORM_GAMES;
const TEAM_UPCOMING = 8;

export type TeamPage = {
  team: TeamProfile;
  /** Most recent first. */
  recent: MatchSummary[];
  upcoming: MatchSummary[];
  /** Built from `recent`, so the numbers and the list below them always agree. */
  form: TeamForm;
  /**
   * The current squad. Empty for a national side between tournaments and for competitions the
   * provider carries no squad for - absent, not a team with no players.
   */
  squad: SquadPlayer[];
  /** Sections the provider had nothing for, so the page can say which rather than show a blank. */
  unavailable: ("recent" | "upcoming" | "squad")[];
};

/**
 * Everything a team page shows, in one request.
 *
 * Four provider calls in parallel rather than four round trips from the phone: on a slow
 * connection the difference is the page appearing at once or in pieces, and the server is the only
 * place that knows they belong together.
 */
export async function getTeamPage(user: AuthUser | null, teamId: number): Promise<TeamPage> {
  if (user) await enforceRateLimit({ userId: user.id, kind: "STATS", ...STATS_LIMIT });
  const provider = statsProvider();

  const unavailable: TeamPage["unavailable"] = [];
  const optional = async <T>(name: TeamPage["unavailable"][number], load: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await load();
    } catch {
      // One missing section is not a failed page. The team's own details are the only part worth
      // failing for, and they are awaited separately below.
      unavailable.push(name);
      return empty;
    }
  };

  const [team, recent, upcoming, squad] = await Promise.all([
    provider.team(teamId),
    optional("recent", () => provider.lastFixtures(teamId, TEAM_RECENT), [] as MatchSummary[]),
    optional("upcoming", () => provider.upcomingFixtures(teamId, TEAM_UPCOMING), [] as MatchSummary[]),
    optional("squad", () => provider.squad(teamId), [] as SquadPlayer[]),
  ]);

  if (!team) throw new AppError("NOT_FOUND", "We couldn't find that team.");

  if (user) await logUsage({ userId: user.id, kind: "STATS", success: true, meta: { teamId } });

  return {
    team,
    recent,
    upcoming,
    form: buildTeamForm({ id: team.id, name: team.name, logo: team.logo }, recent),
    squad,
    unavailable,
  };
}

export type CompetitionPage = {
  competition: CompetitionSummary;
  /**
   * The table. Null for a cup, for a season that has not started, and for any competition whose
   * coverage says it has no standings - three different reasons the page distinguishes.
   */
  standings: StandingRow[] | null;
};

/** A competition's own page: what it is, and its table when it has one. */
export async function getCompetitionPage(user: AuthUser | null, competitionId: number): Promise<CompetitionPage> {
  if (user) await enforceRateLimit({ userId: user.id, kind: "STATS", ...STATS_LIMIT });
  const provider = statsProvider();

  const all = await provider.competitions();
  const competition = all.find((c) => c.id === competitionId);
  if (!competition) throw new AppError("NOT_FOUND", "We couldn't find that competition.");

  // Not even attempted when the provider says there is no table: a cup has none, and asking
  // anyway spends a request to be told so.
  const standings =
    competition.season !== null && competition.coverage?.standings
      ? await provider.standings(competition.id, competition.season).catch(() => null)
      : null;

  return { competition, standings };
}

export type CompetitionDirectory = {
  countries: { name: string; flag: string | null; competitions: number }[];
  competitions: CompetitionSummary[];
  /** How many matched before the page was cut, so a trimmed list can say so. */
  total: number;
};

/**
 * The competition catalogue, filtered.
 *
 * The provider returns about 1,250 competitions across 171 countries in one response, which is
 * far too much to send to a phone. Filtering and paging happen here, over the whole catalogue, so
 * a search reaches every competition while the response stays small.
 */
export async function listCompetitions(opts: {
  country?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Injected by tests. Production always uses the configured provider. */
  provider?: StatsProvider;
}): Promise<CompetitionDirectory> {
  const all = await (opts.provider ?? statsProvider()).competitions();

  const countries = [...new Map(all.map((c) => [c.country, c])).values()]
    .map((c) => ({
      name: c.country,
      flag: c.flag,
      competitions: all.filter((x) => x.country === c.country).length,
    }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const needle = opts.search?.trim().toLowerCase();
  const matched = all.filter((c) => {
    if (opts.country && c.country !== opts.country) return false;
    if (!needle) return true;
    return c.name.toLowerCase().includes(needle) || c.country.toLowerCase().includes(needle);
  });

  // Named competitions first within a country, then alphabetically. No country is promoted over
  // another: this is a global product and a hard-coded order would make it a local one.
  matched.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 60));

  return {
    countries,
    competitions: matched.slice(offset, offset + limit),
    total: matched.length,
  };
}
