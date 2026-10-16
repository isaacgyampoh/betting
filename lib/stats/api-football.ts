import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  CompetitionSummary,
  Lineup,
  LineupPlayer,
  MatchEvent,
  MatchStatus,
  MatchSummary,
  StandingRow,
  StatsProvider,
  TeamStatistics,
} from "@/lib/stats/types";

// API-Football v3 (https://www.api-football.com/documentation-v3). Every response is cached in
// Postgres (stats_cache) so repeated views cost nothing against the daily request quota.

const BASE_URL = "https://v3.football.api-sports.io";

type Params = Record<string, string | number>;

/** The API key's plan doesn't include this data (e.g. current-season tables on the Free plan). */
export class StatsPlanLimitError extends Error {
  constructor(readonly endpoint: string, message: string) {
    super(message);
    this.name = "StatsPlanLimitError";
  }
}

/** The per-minute request limit was hit and nothing is cached: try again shortly. */
export class StatsRateLimitError extends Error {
  constructor(readonly endpoint: string) {
    super("API-Football per-minute rate limit reached");
    this.name = "StatsRateLimitError";
  }
}

const PLAN_LIMITED = "__plan_limited__";
/** The plan in force when a limit was recorded, so an upgrade clears it instead of waiting it out. */
const PLAN_AT = "__plan_at__";
/** Backstop lifetime for a plan-limit marker. Short, because getting this wrong blocks all stats. */
const PLAN_LIMIT_TTL_MS = 6 * 60 * 60_000;
const PLAN_NAME_TTL_MS = 10 * 60_000;

function cacheKey(endpoint: string, params: Params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha256").update(`${endpoint}?${sorted}`).digest("hex");
}

// Raw response shapes (only the fields we use).
type ApiFixture = {
  fixture: { id: number; date: string; status: { short: string; long: string; elapsed: number | null } };
  score?: { halftime?: { home: number | null; away: number | null } | null };
  league: { id: number; name: string; country: string; logo: string | null; season: number };
  teams: { home: { id: number; name: string; logo: string | null }; away: { id: number; name: string; logo: string | null } };
  goals: { home: number | null; away: number | null };
};
type ApiStanding = {
  rank: number;
  team: { id: number; name: string; logo: string | null };
  points: number;
  form: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
};

type ApiStatistics = {
  team: { id: number; name: string; logo: string | null };
  statistics: { type: string; value: number | string | null }[];
};

type ApiLineupPlayer = {
  player: { id: number | null; name: string; number: number | null; pos: string | null; grid: string | null };
};

type ApiLineup = {
  team: { id: number; name: string; logo: string | null };
  formation: string | null;
  coach: { name: string | null } | null;
  startXI: ApiLineupPlayer[] | null;
  substitutes: ApiLineupPlayer[] | null;
};

/**
 * The provider labels each statistic with a display string, and those strings are the contract.
 * Mapped explicitly rather than normalised with a slug function: a provider that renames one
 * should drop that single statistic, not silently mis-file it under another.
 */
const STAT_KEYS = {
  "Ball Possession": "possession",
  "Total Shots": "shotsTotal",
  "Shots on Goal": "shotsOnGoal",
  "Shots off Goal": "shotsOffGoal",
  "Blocked Shots": "shotsBlocked",
  "Shots insidebox": "shotsInsideBox",
  "Shots outsidebox": "shotsOutsideBox",
  "Corner Kicks": "corners",
  Offsides: "offsides",
  Fouls: "fouls",
  "Yellow Cards": "yellowCards",
  "Red Cards": "redCards",
  "Goalkeeper Saves": "saves",
  "Total passes": "passesTotal",
  "Passes accurate": "passesAccurate",
  expected_goals: "expectedGoals",
} as const satisfies Record<string, keyof Omit<TeamStatistics, "team">>;

/**
 * A reported number, or null.
 *
 * Null is the whole point: the provider sends an explicit null for a count it does not have, and a
 * zero would claim that nothing happened. Possession comes as "33%" and expected goals as "1.24",
 * so both are strings that have to be read as numbers - and a string that is not a number is also
 * null rather than 0.
 */
function statValue(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const parsed = Number.parseFloat(raw.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toTeamStatistics(row: ApiStatistics): TeamStatistics {
  const out: TeamStatistics = {
    team: row.team,
    possession: null, shotsTotal: null, shotsOnGoal: null, shotsOffGoal: null, shotsBlocked: null,
    shotsInsideBox: null, shotsOutsideBox: null, corners: null, offsides: null, fouls: null,
    yellowCards: null, redCards: null, saves: null, passesTotal: null, passesAccurate: null,
    expectedGoals: null,
  };
  for (const { type, value } of row.statistics ?? []) {
    const key = STAT_KEYS[type as keyof typeof STAT_KEYS];
    if (key) out[key] = statValue(value);
  }
  return out;
}

function toLineup(row: ApiLineup): Lineup {
  const player = (p: ApiLineupPlayer): LineupPlayer => ({
    id: p.player.id,
    name: p.player.name,
    number: p.player.number,
    position: p.player.pos,
    grid: p.player.grid,
  });
  return {
    team: row.team,
    formation: row.formation || null,
    coach: row.coach?.name ?? null,
    startXI: (row.startXI ?? []).map(player),
    substitutes: (row.substitutes ?? []).map(player),
  };
}

/** Home side first, so a screen never has to work out which column is which. */
function homeFirst<T extends { team: { id: number } }>(rows: T[], homeTeamId: number): T[] {
  return [...rows].sort((a, b) => (a.team.id === homeTeamId ? -1 : b.team.id === homeTeamId ? 1 : 0));
}

type ApiTeamProfile = {
  team: { id: number; name: string; logo: string | null; code: string | null; country: string | null; founded: number | null; national: boolean };
  venue: { name: string | null; city: string | null; capacity: number | null } | null;
};

type ApiSquad = {
  players: { id: number | null; name: string; number: number | null; position: string | null; age: number | null; photo: string | null }[] | null;
};

const STATUS: Record<string, MatchStatus> = {
  TBD: "SCHEDULED", NS: "SCHEDULED",
  "1H": "LIVE", HT: "LIVE", "2H": "LIVE", ET: "LIVE", BT: "LIVE", P: "LIVE", SUSP: "LIVE", INT: "LIVE", LIVE: "LIVE",
  FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED", AWD: "FINISHED", WO: "FINISHED",
  PST: "POSTPONED", CANC: "CANCELLED", ABD: "CANCELLED",
};

export function toMatchSummary(f: ApiFixture): MatchSummary {
  return {
    id: f.fixture.id,
    kickoffAt: new Date(f.fixture.date).toISOString(),
    status: STATUS[f.fixture.status.short] ?? "SCHEDULED",
    statusLabel: f.fixture.status.elapsed && STATUS[f.fixture.status.short] === "LIVE" ? `${f.fixture.status.elapsed}'` : f.fixture.status.long,
    league: { id: f.league.id, name: f.league.name, country: f.league.country, season: f.league.season, logo: f.league.logo },
    home: { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo },
    away: { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo },
    goals: f.goals,
    halftime: f.score?.halftime ?? null,
  };
}

type ApiEvent = {
  time: { elapsed: number | null; extra: number | null };
  team: { id: number };
  player: { name: string | null } | null;
  assist: { name: string | null } | null;
  type: string;
  detail: string;
};

type ApiLeague = {
  // Only `seasons` was needed while this type served coverage() alone; the catalogue needs the
  // rest of what /leagues returns.
  league?: { id: number; name: string; type?: string; logo?: string | null };
  country?: { name?: string; flag?: string | null };
  seasons?: {
    year: number;
    current: boolean;
    coverage?: {
      standings?: boolean;
      fixtures?: { events?: boolean; lineups?: boolean; statistics_fixtures?: boolean; statistics_players?: boolean };
    };
  }[];
};

/**
 * The provider's wording into ours. Anything it calls something we do not model keeps its own
 * words in `detail` rather than being forced into the nearest type.
 */
function toMatchEvent(e: ApiEvent, homeTeamId: number): MatchEvent {
  const detail = e.detail ?? "";
  const type: MatchEvent["type"] =
    e.type === "Goal"
      ? detail === "Own Goal"
        ? "OWN_GOAL"
        : detail === "Penalty"
          ? "PENALTY"
          : detail === "Missed Penalty"
            ? "PENALTY_MISSED"
            : "GOAL"
      : e.type === "Card"
        ? detail === "Red Card"
          ? "RED"
          : /second yellow/i.test(detail)
            ? "SECOND_YELLOW"
            : "YELLOW"
        : e.type === "subst"
          ? "SUBSTITUTION"
          : "VAR";
  return {
    minute: e.time?.elapsed ?? 0,
    extra: e.time?.extra ?? null,
    side: e.team?.id === homeTeamId ? "HOME" : "AWAY",
    type,
    player: e.player?.name ?? null,
    other: e.assist?.name ?? null,
    detail,
  };
}

export function createApiFootballProvider(apiKey: string): StatsProvider {
  /**
   * The subscription's plan name, cached briefly. `/status` does not count against the daily quota,
   * so this is cheap, and it is what lets an upgrade take effect immediately.
   */
  async function currentPlan(): Promise<string | null> {
    const key = "apifootball:plan";
    const hit = await db.statsCache.findUnique({ where: { key } }).catch(() => null);
    if (hit && hit.expiresAt > new Date()) return ((hit.payload as { plan?: string }).plan ?? null) as string | null;
    try {
      const res = await fetch(`${BASE_URL}/status`, { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
      const body = (await res.json()) as { response?: { subscription?: { plan?: string; active?: boolean } } };
      const sub = body.response?.subscription;
      const plan = sub?.active === false ? `${sub.plan ?? "unknown"} (inactive)` : (sub?.plan ?? null);
      await db.statsCache
        .upsert({
          where: { key },
          create: { key, endpoint: "/status", params: {}, payload: { plan }, expiresAt: new Date(Date.now() + PLAN_NAME_TTL_MS) },
          update: { payload: { plan }, expiresAt: new Date(Date.now() + PLAN_NAME_TTL_MS), fetchedAt: new Date() },
        })
        .catch(() => {});
      return plan;
    } catch {
      return null; // Unknown plan: fall back to trusting the marker rather than hammering the API.
    }
  }

  /**
   * Whether a recorded plan limit still applies. It does not if the subscription has changed since
   * it was recorded, so upgrading the plan takes effect at once rather than leaving stats dark until
   * the marker expires. Markers written before this check existed carry no plan and are honoured.
   */
  async function planLimitStillApplies(key: string, marker: Record<string, unknown>, context: string): Promise<boolean> {
    const recordedOn = marker[PLAN_AT];
    if (typeof recordedOn !== "string") return true;
    const plan = await currentPlan();
    if (!plan || plan === recordedOn) return true;
    logger.info("stats.plan_changed_clearing_limit", { context, was: recordedOn, now: plan });
    await db.statsCache.delete({ where: { key } }).catch(() => {});
    return false;
  }

  /** A plan limit applies to a whole kind of query (e.g. every team's `last=` form), not one request. */
  async function capabilityBlocked(capability: string): Promise<void> {
    const key = `capability:${capability}`;
    const hit = await db.statsCache.findUnique({ where: { key } });
    const marker = hit?.payload as Record<string, unknown> | undefined;
    if (!hit || hit.expiresAt <= new Date() || !marker || !(PLAN_LIMITED in marker)) return;
    if (await planLimitStillApplies(key, marker, capability)) {
      throw new StatsPlanLimitError(capability, String(marker[PLAN_LIMITED]));
    }
  }

  async function rememberPlanLimit(key: string, endpoint: string, params: Params, message: string) {
    const marker = { [PLAN_LIMITED]: message, [PLAN_AT]: await currentPlan() } as unknown as Prisma.InputJsonValue;
    const expiresAt = new Date(Date.now() + PLAN_LIMIT_TTL_MS);
    await writeCache(key, endpoint, params, marker as Prisma.InputJsonValue, expiresAt);
  }

  /**
   * One statement. Prisma's upsert opens a transaction - four round trips to the database - and
   * this runs after every cache miss, several times per fixture researched.
   */
  async function writeCache(key: string, endpoint: string, params: Params, payload: Prisma.InputJsonValue, expiresAt: Date) {
    await db.$executeRaw`
      insert into stats_cache (key, endpoint, params, payload, expires_at, fetched_at)
      values (${key}, ${endpoint}, ${JSON.stringify(params)}::jsonb, ${JSON.stringify(payload)}::jsonb, ${expiresAt}, now())
      on conflict (key) do update
        set payload = excluded.payload, expires_at = excluded.expires_at, fetched_at = now()
    `;
  }

  /**
   * Building a slip researches a shortlist of fixtures at once, and fixtures in the same league ask
   * for exactly the same league and season data. Without this each one misses the cache (nothing is
   * written yet), fetches the same URL, and writes the same row - so widening the research made it
   * slower rather than faster: sixteen at a time took 15s where eight took 11s.
   *
   * Entries are removed as soon as they settle, so this only ever holds calls that are in the air.
   */
  const inFlight = new Map<string, Promise<unknown[]>>();

  function call<T>(endpoint: string, params: Params, ttlMs: number, capability?: string): Promise<T[]> {
    const key = cacheKey(endpoint, params);
    const running = inFlight.get(key);
    if (running) return running as Promise<T[]>;
    const started = fetchOnce<T>(endpoint, params, ttlMs, capability).finally(() => inFlight.delete(key));
    inFlight.set(key, started as Promise<unknown[]>);
    return started;
  }

  async function fetchOnce<T>(endpoint: string, params: Params, ttlMs: number, capability?: string): Promise<T[]> {
    if (capability) await capabilityBlocked(capability);
    const key = cacheKey(endpoint, params);
    const hit = await db.statsCache.findUnique({ where: { key } });
    if (hit && hit.expiresAt > new Date()) {
      const cached = hit.payload as unknown;
      if (cached && typeof cached === "object" && PLAN_LIMITED in cached) {
        const marker = cached as Record<string, unknown>;
        // Same rule as the capability marker: a limit recorded on an older plan no longer binds.
        if (await planLimitStillApplies(key, marker, endpoint)) {
          throw new StatsPlanLimitError(endpoint, String(marker[PLAN_LIMITED]));
        }
      } else {
        return cached as T[];
      }
    }

    const url = `${BASE_URL}${endpoint}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
    let body: { response?: T[]; errors?: unknown };
    try {
      const res = await fetch(url, { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      logger.error("stats.request_failed", { endpoint, params, err });
      if (hit) return hit.payload as unknown as T[]; // serve stale rather than nothing
      throw new AppError("STATS_UNAVAILABLE", "Match stats are unavailable right now. Please try again later.", { cause: err });
    }

    // API-Football returns `errors` as [] when fine, or an object like { token: "..." } on failure.
    const errors: unknown[] = !body.errors ? [] : Array.isArray(body.errors) ? body.errors : Object.values(body.errors as object);
    const planError = (body.errors as Record<string, unknown> | undefined)?.plan;
    if (typeof planError === "string") {
      // Not an outage: this key's plan excludes the data. Remember for a day to save quota and latency.
      logger.warn("stats.plan_limited", { endpoint, params, capability, message: planError });
      await rememberPlanLimit(key, endpoint, params, planError);
      if (capability) await rememberPlanLimit(`capability:${capability}`, endpoint, params, planError);
      throw new StatsPlanLimitError(endpoint, planError);
    }
    if ((body.errors as Record<string, unknown> | undefined)?.rateLimit) {
      logger.warn("stats.rate_limited", { endpoint, params });
      if (hit) return hit.payload as unknown as T[]; // stale beats nothing
      throw new StatsRateLimitError(endpoint);
    }
    if (errors.length) {
      logger.error("stats.api_error", { endpoint, params, errors: body.errors });
      if (hit) return hit.payload as unknown as T[];
      throw new AppError("STATS_UNAVAILABLE", "Match stats are unavailable right now. Please try again later.");
    }

    const payload = (body.response ?? []) as T[];

    // Best effort. The data is already in hand, and failing the request because it could not be
    // cached would throw away a good answer to save a later one - exactly backwards.
    //
    // This is not hypothetical: the competition catalogue is one response carrying about 1,250
    // leagues, and the first uncached call for it returned a 500 from production while every
    // later call succeeded. A write that large can be refused where a small one is not, and the
    // caller should never see the difference.
    try {
      await writeCache(key, endpoint, params, payload as unknown as Prisma.InputJsonValue, new Date(Date.now() + ttlMs));
    } catch (err) {
      logger.warn("stats.cache_write_failed", { endpoint, key, size: JSON.stringify(payload).length, err });
    }
    return payload;
  }

  const MIN = 60_000;
  const HOUR = 60 * MIN;

  return {
    source: "api-football",
    async fixturesByDate(date) {
      const isPast = date < new Date().toISOString().slice(0, 10);
      const rows = await call<ApiFixture>("/fixtures", { date }, isPast ? 24 * HOUR : 15 * MIN);
      return rows.map(toMatchSummary);
    },
    async fixture(id) {
      const rows = await call<ApiFixture>("/fixtures", { id }, 10 * MIN);
      return rows[0] ? toMatchSummary(rows[0]) : null;
    },
    async lastFixtures(teamId, count) {
      return (await call<ApiFixture>("/fixtures", { team: teamId, last: count }, 6 * HOUR, "fixtures-last")).map(toMatchSummary);
    },
    async headToHead(homeId, awayId, count) {
      // No `last` parameter: it isn't available on every plan. Fetch all meetings, keep the latest.
      const [a, b] = [homeId, awayId].sort((x, y) => x - y); // same cache entry either way round
      const all = (await call<ApiFixture>("/fixtures/headtohead", { h2h: `${a}-${b}` }, 12 * HOUR)).map(toMatchSummary);
      return all
        .filter((m) => m.status === "FINISHED")
        .sort((x, y) => y.kickoffAt.localeCompare(x.kickoffAt))
        .slice(0, count);
    },
    /**
     * Goals, cards and substitutions. Cached briefly while a match is live and for a day once it
     * is not: a finished timeline never changes, and a live one is the point of opening the page.
     */
    async events(fixtureId, homeTeamId) {
      const rows = await call<ApiEvent>("/fixtures/events", { fixture: fixtureId }, 2 * MIN, "fixtures-events");
      return rows
        .map((e) => toMatchEvent(e, homeTeamId))
        .sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0));
    },
    /**
     * Team statistics. Cached briefly while a match is live and for a day once it is not: a
     * finished match's counts never change, and a live one is why the page is open.
     *
     * An empty array means the competition does not carry them. That is not an error, and it is
     * only distinguishable from "nothing has happened yet" via the coverage flag.
     */
    async statistics(fixtureId, homeTeamId) {
      const rows = await call<ApiStatistics>("/fixtures/statistics", { fixture: fixtureId }, 2 * MIN, "fixtures-statistics");
      return homeFirst(rows.map(toTeamStatistics), homeTeamId);
    },
    /**
     * Line-ups. Published about an hour before kick-off and unchanged afterwards, so cached for
     * longer than the live panels.
     */
    async lineups(fixtureId, homeTeamId) {
      const rows = await call<ApiLineup>("/fixtures/lineups", { fixture: fixtureId }, 10 * MIN, "fixtures-lineups");
      return homeFirst(rows.map(toLineup), homeTeamId);
    },
    /** A team's own details. Clubs are renamed and rebuilt rarely, so this is cached for a day. */
    async team(teamId) {
      const rows = await call<ApiTeamProfile>("/teams", { id: teamId }, 24 * HOUR);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.team.id,
        name: row.team.name,
        logo: row.team.logo,
        code: row.team.code,
        country: row.team.country,
        founded: row.team.founded,
        national: row.team.national === true,
        venue: row.venue?.name ? row.venue : null,
      };
    },
    /**
     * The next fixtures. Cached for an hour: a fixture list changes when a match is moved, which
     * is news on the day and irrelevant the rest of the time.
     */
    async upcomingFixtures(teamId, count) {
      const rows = await call<ApiFixture>("/fixtures", { team: teamId, next: count }, HOUR, "fixtures-next");
      return rows.map(toMatchSummary).sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
    },
    /**
     * The squad. Empty for national sides between tournaments and for competitions the provider
     * does not carry one for - absent, not a team with no players.
     */
    async squad(teamId) {
      const rows = await call<ApiSquad>("/players/squads", { team: teamId }, 24 * HOUR);
      return (rows[0]?.players ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        number: p.number,
        position: p.position,
        age: p.age,
        photo: p.photo,
      }));
    },
    /**
     * The whole catalogue. One call returns every competition the plan exposes - 1,249 of them
     * across 171 countries when this was written - so it is cached for a day and filtered in the
     * service rather than re-fetched per country.
     */
    async competitions() {
      const rows = await call<ApiLeague>("/leagues", {}, 24 * HOUR, "leagues-all");
      // A row without a league object is not a competition. Dropped rather than rendered as one
      // with an empty name.
      return rows.flatMap((row): CompetitionSummary[] => {
        const league = row.league;
        if (!league) return [];
        const season = row.seasons?.find((s) => s.current) ?? row.seasons?.at(-1);
        const f = season?.coverage?.fixtures ?? {};
        return [{
          id: league.id,
          name: league.name,
          country: row.country?.name ?? "",
          logo: league.logo ?? null,
          flag: row.country?.flag ?? null,
          type: league.type ?? "League",
          season: season?.year ?? null,
          coverage: season
            ? {
                events: !!f.events,
                lineups: !!f.lineups,
                statistics: !!f.statistics_fixtures,
                playerStats: !!f.statistics_players,
                standings: !!season.coverage?.standings,
              }
            : null,
        }];
      });
    },
    async coverage(leagueId, season) {
      const rows = await call<ApiLeague>("/leagues", { id: leagueId }, 24 * HOUR);
      const year = rows[0]?.seasons?.find((x) => x.year === season) ?? rows[0]?.seasons?.find((x) => x.current);
      if (!year) return null;
      const f = year.coverage?.fixtures ?? {};
      return {
        events: !!f.events,
        lineups: !!f.lineups,
        statistics: !!f.statistics_fixtures,
        playerStats: !!f.statistics_players,
        standings: !!year.coverage?.standings,
      };
    },
    async standings(leagueId, season) {
      const rows = await call<{ league: { standings: ApiStanding[][] } }>("/standings", { league: leagueId, season }, 6 * HOUR, `standings-season-${season}`);
      const table = rows[0]?.league.standings.flat();
      if (!table?.length) return null;
      return table.map(
        (r): StandingRow => ({
          rank: r.rank,
          team: r.team,
          played: r.all.played,
          won: r.all.win,
          drawn: r.all.draw,
          lost: r.all.lose,
          goalsFor: r.all.goals.for,
          goalsAgainst: r.all.goals.against,
          points: r.points,
          form: r.form,
        }),
      );
    },
  };
}
