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
    await db.statsCache.upsert({
      where: { key },
      create: { key, endpoint, params, payload: marker, expiresAt },
      update: { payload: marker, expiresAt, fetchedAt: new Date() },
    });
  }

  async function call<T>(endpoint: string, params: Params, ttlMs: number, capability?: string): Promise<T[]> {
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
