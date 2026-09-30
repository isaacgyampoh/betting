import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { MatchStatus, MatchSummary, StandingRow, StatsProvider } from "@/lib/stats/types";

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

const PLAN_LIMITED = "__plan_limited__";

function cacheKey(endpoint: string, params: Params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha256").update(`${endpoint}?${sorted}`).digest("hex");
}

// Raw response shapes (only the fields we use).
type ApiFixture = {
  fixture: { id: number; date: string; status: { short: string; long: string; elapsed: number | null } };
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
  };
}

export function createApiFootballProvider(apiKey: string): StatsProvider {
  async function call<T>(endpoint: string, params: Params, ttlMs: number): Promise<T[]> {
    const key = cacheKey(endpoint, params);
    const hit = await db.statsCache.findUnique({ where: { key } });
    if (hit && hit.expiresAt > new Date()) {
      const cached = hit.payload as unknown;
      if (cached && typeof cached === "object" && PLAN_LIMITED in cached) {
        throw new StatsPlanLimitError(endpoint, String((cached as Record<string, unknown>)[PLAN_LIMITED]));
      }
      return cached as T[];
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
      logger.warn("stats.plan_limited", { endpoint, params, message: planError });
      const marker = { [PLAN_LIMITED]: planError } as unknown as Prisma.InputJsonValue;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
      await db.statsCache.upsert({
        where: { key },
        create: { key, endpoint, params, payload: marker, expiresAt },
        update: { payload: marker, expiresAt, fetchedAt: new Date() },
      });
      throw new StatsPlanLimitError(endpoint, planError);
    }
    if (errors.length) {
      logger.error("stats.api_error", { endpoint, params, errors: body.errors });
      if (hit) return hit.payload as unknown as T[];
      throw new AppError("STATS_UNAVAILABLE", "Match stats are unavailable right now. Please try again later.");
    }

    const payload = (body.response ?? []) as T[];
    const expiresAt = new Date(Date.now() + ttlMs);
    const json = payload as unknown as Prisma.InputJsonValue;
    await db.statsCache.upsert({
      where: { key },
      create: { key, endpoint, params, payload: json, expiresAt },
      update: { payload: json, expiresAt, fetchedAt: new Date() },
    });
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
      return (await call<ApiFixture>("/fixtures", { team: teamId, last: count }, 6 * HOUR)).map(toMatchSummary);
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
    async standings(leagueId, season) {
      const rows = await call<{ league: { standings: ApiStanding[][] } }>("/standings", { league: leagueId, season }, 6 * HOUR);
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
