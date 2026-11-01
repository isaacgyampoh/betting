import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  CompetitionSummary,
  LeagueCoverage,
  Lineup,
  MatchEvent,
  MatchStatus,
  MatchSummary,
  SquadPlayer,
  StatsProvider,
  TeamProfile,
  TeamStatistics,
} from "@/lib/stats/types";

/**
 * GOAL API (api.goal-api.com) as a stats provider.
 *
 * Added after 1 November 2026, when the API-Football account's daily budget ran out and the match
 * list answered 503 for a whole day with no second source to fall back on. One provider for the
 * thing the product opens on was the actual fragility; the quota was only what exposed it.
 *
 * What it is good at, measured rather than assumed: a full day is 1,149 fixtures, it gives an
 * explicit `kickoffUtc` instead of a local time plus an offset, half-time scores are present, and
 * team and league badges arrive on the fixture itself. The free tier allows ~1,000 requests a day
 * against API-Football's 100.
 *
 * Where it is thinner, and this is why it is not a drop-in replacement for everything:
 *
 *   * **Match detail is sparser.** A finished 1-3 game returned four events, all goals, with no
 *     cards or substitutions; `hasLineups` was false with only a coach listed; and the statistics
 *     vocabulary is its own ("On Target", "Ball Possession": "60%") rather than API-Football's.
 *     Mapping those honestly is a separate piece of work, so the three panels that depend on them
 *     return empty here and the match page reports them as unavailable - which it already does
 *     properly, because that mechanism was built for competitions API-Football does not cover.
 *   * **Lookups need its own opaque ids.** Teams and leagues are addressed by cuid
 *     (`cmr7ben830y52rx0671s2yah1`), and the numeric `apiId` that also exists is *not* accepted:
 *     `/teams/1001` is a 404. Worse, `/teams/1001/results` answers 200 with zero matches, so
 *     passing the wrong kind of id reads as "no recent form" rather than as an error.
 *
 * That last point is what the id map below exists for. Our own `StatsProvider` contract is numeric
 * (`TeamRef.id: number`, `standings(leagueId: number, …)`), and widening it would reach the Flutter
 * app and an Int column, so instead the numeric apiId is used outwards and the cuid needed to call
 * back is remembered. The apiId is read from the badge URL
 * (`…/badges/1001_lanus.jpg` -> 1001), which costs no extra request and was checked against the
 * team's own record: Lanús is 1001 in both places.
 */
const BASE_URL = "https://api.goal-api.com/v1";

/** 100 is the ceiling; `limit=200` is a 400. A full day is therefore 12 requests. */
const PAGE_SIZE = 100;
/** Guard against an endpoint that never returns a short page. 20 pages is ~2,000 fixtures. */
const MAX_PAGES = 20;

const LIVE_TTL_MS = 30_000;
const DAY_TTL_MS = 10 * 60_000;
const SETTLED_TTL_MS = 24 * 60 * 60_000;
/** Long: a cuid never changes, and losing the mapping costs a whole panel. */
const ID_MAP_TTL_MS = 90 * 24 * 60 * 60_000;

type GoalFixture = {
  id: string;
  apiId: string;
  countryName: string | null;
  leagueId: string;
  leagueName: string | null;
  leagueYear: number | string | null;
  leagueLogo: string | null;
  kickoffUtc: string;
  matchStatus: string;
  matchPeriod: string | null;
  matchMinute: string | null;
  matchElapsed: number | null;
  homeTeamId: string;
  homeTeamName: string | null;
  homeTeamScore: number | null;
  homeTeamHalftimeScore: number | null;
  awayTeamId: string;
  awayTeamName: string | null;
  awayTeamScore: number | null;
  awayTeamHalftimeScore: number | null;
  teamHomeBadge: string | null;
  teamAwayBadge: string | null;
  homeTeam?: { id: string; name: string; badge: string | null } | null;
  awayTeam?: { id: string; name: string; badge: string | null } | null;
};

type Envelope<T> = { success?: boolean; data?: T; error?: string; message?: string; code?: string };

export function createGoalApiProvider(apiKey: string): StatsProvider {
  /**
   * One request, cached in Postgres exactly as the API-Football client caches its own.
   *
   * The errors are classified rather than collapsed, for the same reason that client now does it:
   * an exhausted budget, a refused key and a genuine outage need different responses, and the
   * November outage was a missing branch in precisely that decision.
   */
  async function call<T>(path: string, ttlMs: number): Promise<T | null> {
    const key = `goal:${path}`;
    const hit = await db.statsCache.findUnique({ where: { key } });
    if (hit && hit.expiresAt > new Date()) return hit.payload as T;

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      logger.error(timedOut ? "goal.request_timeout" : "goal.request_failed", { path, err });
      // An hour's grace, the same window the other provider uses and for the same reason: this
      // cache holds scores, and an old score is a scoreboard showing finished matches in play.
      if (hit && Date.now() - hit.expiresAt.getTime() < 60 * 60_000) return hit.payload as T;
      throw new AppError("STATS_UNAVAILABLE", "Match stats are unavailable right now. Please try again later.", { cause: err });
    }

    const body = (await res.json().catch(() => null)) as Envelope<T> | null;

    // A 404 is routinely "this match has no standings", not a fault. It is cached briefly so the
    // same empty answer is not re-fetched on every page view.
    if (res.status === 404) {
      await write(key, path, null, Math.min(ttlMs, 60 * 60_000));
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      logger.error("goal.key_rejected", { path, status: res.status, message: body?.error ?? body?.message });
      throw new AppError("STATS_UNAVAILABLE", "Match stats are unavailable right now. Please try again later.");
    }
    if (res.status === 429) {
      logger.error("goal.rate_limited", { path, message: body?.error ?? body?.message });
      if (hit && Date.now() - hit.expiresAt.getTime() < 60 * 60_000) return hit.payload as T;
      throw new AppError("STATS_UNAVAILABLE", "Match stats are busy right now. Please try again in a minute.");
    }
    if (!res.ok || body?.success === false) {
      logger.error("goal.api_error", { path, status: res.status, message: body?.error ?? body?.message, code: body?.code });
      if (hit && Date.now() - hit.expiresAt.getTime() < 60 * 60_000) return hit.payload as T;
      throw new AppError("STATS_UNAVAILABLE", "Match stats are unavailable right now. Please try again later.");
    }

    const payload = (body?.data ?? null) as T | null;
    await write(key, path, payload, ttlMs);
    return payload;
  }

  /** Best effort, like the other client: a failed cache write must not discard a good answer. */
  async function write(key: string, path: string, payload: unknown, ttlMs: number) {
    const expiresAt = new Date(Date.now() + ttlMs);
    try {
      await db.statsCache.upsert({
        where: { key },
        create: { key, endpoint: path, params: {}, payload: payload as never, expiresAt },
        update: { payload: payload as never, expiresAt, fetchedAt: new Date() },
      });
    } catch (err) {
      logger.warn("goal.cache_write_failed", { path, err: String(err) });
    }
  }

  // ---------------------------------------------------------------- identifiers

  /** `https://media.goal-api.com/badges/1001_lanus.jpg` -> 1001. */
  function apiIdFromAsset(url: string | null | undefined): number | null {
    const m = /\/(\d+)_/.exec(url ?? "");
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Remembers which cuid a numeric id belongs to, so a later call can address it.
   *
   * Populated whenever a fixture is read, which is always before anything can be opened, so no
   * request is ever spent on the mapping itself.
   */
  async function remember(kind: "team" | "league", apiId: number | null, cuid: string) {
    if (!apiId) return;
    await write(`goal:map:${kind}:${apiId}`, `map/${kind}`, { cuid }, ID_MAP_TTL_MS);
  }

  async function resolve(kind: "team" | "league", apiId: number): Promise<string | null> {
    const hit = await db.statsCache.findUnique({ where: { key: `goal:map:${kind}:${apiId}` } });
    const cuid = (hit?.payload as { cuid?: string } | null)?.cuid;
    if (cuid) return cuid;
    // Deliberately not guessed. Calling an endpoint with the wrong kind of id returns 200 and an
    // empty list, which would be published as "no recent form" for a team that has plenty.
    logger.info("goal.id_unmapped", { kind, apiId });
    return null;
  }

  // ---------------------------------------------------------------- mapping

  /**
   * `matchStatus` is the authority, not `matchLive`.
   *
   * Across one real day: 17 fixtures were `FINISHED` with `matchLive=1`, and one was `SCHEDULED`
   * with `matchPeriod=HALF_TIME`. Trusting the live flag would have shown finished games as in
   * play, which is the single worst thing a scoreboard can do.
   */
  function toStatus(f: GoalFixture): MatchStatus {
    switch ((f.matchStatus ?? "").toUpperCase()) {
      case "LIVE":
      case "HALF_TIME":
      case "EXTRA_TIME":
      case "PENALTIES":
        return "LIVE";
      case "FINISHED":
      case "AWARDED":
      case "AFTER_PEN":
      case "AFTER_ET":
        return "FINISHED";
      case "POSTPONED":
      case "DELAYED":
        return "POSTPONED";
      case "CANCELLED":
      case "ABANDONED":
      case "SUSPENDED":
        return "CANCELLED";
      default:
        return "SCHEDULED";
    }
  }

  function statusLabel(f: GoalFixture, status: MatchStatus): string {
    if (status === "LIVE") {
      const minute = f.matchElapsed ?? Number(f.matchMinute);
      if ((f.matchPeriod ?? "") === "HALF_TIME") return "HT";
      return Number.isFinite(minute) && minute > 0 ? `${minute}'` : "Live";
    }
    if (status === "FINISHED") return "FT";
    if (status === "POSTPONED") return "Postponed";
    if (status === "CANCELLED") return "Cancelled";
    return "";
  }

  async function toMatchSummary(f: GoalFixture): Promise<MatchSummary> {
    const homeId = apiIdFromAsset(f.teamHomeBadge ?? f.homeTeam?.badge);
    const awayId = apiIdFromAsset(f.teamAwayBadge ?? f.awayTeam?.badge);
    const leagueId = apiIdFromAsset(f.leagueLogo);
    await Promise.all([
      remember("team", homeId, f.homeTeamId),
      remember("team", awayId, f.awayTeamId),
      remember("league", leagueId, f.leagueId),
    ]);

    const status = toStatus(f);
    const season = Number(f.leagueYear);
    return {
      id: Number(f.apiId),
      kickoffAt: new Date(f.kickoffUtc).toISOString(),
      status,
      statusLabel: statusLabel(f, status),
      league: {
        id: leagueId ?? 0,
        name: f.leagueName ?? "",
        country: f.countryName ?? "",
        season: Number.isFinite(season) ? season : new Date(f.kickoffUtc).getUTCFullYear(),
        logo: f.leagueLogo ?? null,
      },
      // The nested object carries proper diacritics ("Lanús") where the flat field does not ("Lanus").
      home: { id: homeId ?? 0, name: f.homeTeam?.name ?? f.homeTeamName ?? "", logo: f.teamHomeBadge ?? null },
      away: { id: awayId ?? 0, name: f.awayTeam?.name ?? f.awayTeamName ?? "", logo: f.teamAwayBadge ?? null },
      goals: { home: f.homeTeamScore, away: f.awayTeamScore },
      halftime:
        f.homeTeamHalftimeScore === null && f.awayTeamHalftimeScore === null
          ? null
          : { home: f.homeTeamHalftimeScore, away: f.awayTeamHalftimeScore },
    };
  }

  const summaries = (list: GoalFixture[]) => Promise.all(list.map(toMatchSummary));

  /** Walks `limit`/`offset` until a short page. This endpoint returns no total to go by. */
  async function paged(path: string, ttlMs: number, cap = MAX_PAGES): Promise<GoalFixture[]> {
    const out: GoalFixture[] = [];
    for (let page = 0; page < cap; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const batch = await call<GoalFixture[]>(`${path}${sep}limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, ttlMs);
      if (!batch?.length) break;
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  return {
    source: "goal-api",

    async fixturesByDate(date) {
      return summaries(await paged(`/fixtures/date/${date}`, DAY_TTL_MS));
    },

    async fixture(id) {
      const f = await call<GoalFixture>(`/fixtures/${id}`, LIVE_TTL_MS);
      return f ? toMatchSummary(f) : null;
    },

    async lastFixtures(teamId, count) {
      const cuid = await resolve("team", teamId);
      if (!cuid) return [];
      const list = await call<GoalFixture[]>(`/teams/${cuid}/results?limit=${count}`, SETTLED_TTL_MS);
      return summaries(list ?? []);
    },

    async headToHead(homeId, awayId, count) {
      const [a, b] = await Promise.all([resolve("team", homeId), resolve("team", awayId)]);
      if (!a || !b) return [];
      const payload = await call<{ matches?: GoalFixture[] }>(`/h2h/${a}/${b}/direct`, SETTLED_TTL_MS);
      return summaries((payload?.matches ?? []).slice(0, count));
    },

    async standings(leagueId) {
      const cuid = await resolve("league", leagueId);
      if (!cuid) return null;
      type Row = {
        teamId: string;
        teamName: string | null;
        position?: number | string | null;
        points?: number | string | null;
        played?: number | string | null;
        wins?: number | string | null;
        draws?: number | string | null;
        losses?: number | string | null;
        goalsFor?: number | string | null;
        goalsAgainst?: number | string | null;
        form?: string | null;
        teamBadge?: string | null;
      };
      const rows = await call<Row[]>(`/standings/${cuid}/form`, 6 * 60 * 60_000);
      if (!rows?.length) return null;
      const num = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      return rows.map((r, i) => ({
        rank: r.position ? num(r.position) : i + 1,
        team: { id: apiIdFromAsset(r.teamBadge) ?? 0, name: r.teamName ?? "", logo: r.teamBadge ?? null },
        played: num(r.played),
        won: num(r.wins),
        drawn: num(r.draws),
        lost: num(r.losses),
        goalsFor: num(r.goalsFor),
        goalsAgainst: num(r.goalsAgainst),
        points: num(r.points),
        form: r.form ?? null,
      }));
    },

    async events(fixtureId, _homeTeamId, settled) {
      type Ev = {
        time?: string | null;
        timeNum?: number | null;
        type?: string | null;
        homeScorer?: string | null;
        awayScorer?: string | null;
        homeAssist?: string | null;
        awayAssist?: string | null;
        info?: string | null;
      };
      const list = await call<Ev[]>(`/fixtures/${fixtureId}/events`, settled ? SETTLED_TTL_MS : LIVE_TTL_MS);
      if (!list?.length) return [];
      const out: MatchEvent[] = [];
      for (const e of list) {
        // The side is implicit in which scorer field is filled, which is also the only way to know
        // it - there is no team field on an event.
        const side: "HOME" | "AWAY" | null = e.homeScorer ? "HOME" : e.awayScorer ? "AWAY" : null;
        if (!side) continue;
        const raw = (e.type ?? "").toUpperCase();
        const type: MatchEvent["type"] =
          raw.includes("OWN") ? "OWN_GOAL"
          : raw.includes("PEN") && raw.includes("MISS") ? "PENALTY_MISSED"
          : raw.includes("PEN") ? "PENALTY"
          : raw.includes("GOAL") ? "GOAL"
          : raw.includes("YELLOW") && raw.includes("SECOND") ? "SECOND_YELLOW"
          : raw.includes("YELLOW") ? "YELLOW"
          : raw.includes("RED") ? "RED"
          : raw.includes("SUB") ? "SUBSTITUTION"
          : raw.includes("VAR") ? "VAR"
          : "GOAL";
        const [base, extra] = String(e.time ?? e.timeNum ?? "").split("+");
        const minute = Number(base);
        out.push({
          minute: Number.isFinite(minute) ? minute : 0,
          extra: extra ? Number(extra) || null : null,
          side,
          type,
          player: (side === "HOME" ? e.homeScorer : e.awayScorer) ?? null,
          other: (side === "HOME" ? e.homeAssist : e.awayAssist) ?? null,
          detail: e.info ?? e.type ?? "",
        });
      }
      return out.sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0));
    },

    // ------------------------------------------------------------ not yet mapped
    //
    // Every one of these returns an honest empty rather than a guess, and the match page already
    // turns that into a stated "not available" note instead of a blank panel - the mechanism exists
    // because API-Football does not cover every competition either.
    //
    // They are not stubs left for neatness. Each needs a shape decision that wants its own look:
    //
    //   statistics  GOAL reports rows like {type:"On Target", home:"11", away:"5"} and
    //               {type:"Ball Possession", home:"60%"} - its own vocabulary, with percentages as
    //               strings, and no shots-total or fouls in the sample taken. Mapping it onto
    //               TeamStatistics means deciding what "On Target" is and what to leave null, and
    //               a wrong guess there publishes a number that is not the number.
    //   lineups     `hasLineups` was false on the finished match sampled, with only a coach listed.
    //   coverage    GOAL publishes no per-competition coverage flags, so there is nothing to read.
    //               Null is correct: it means "the provider does not say", which is true.
    //   team/squad/upcomingFixtures/competitions
    //               Reachable, but each needs its own id-mapping and shape work.
    async coverage(): Promise<LeagueCoverage | null> {
      return null;
    },
    async statistics(): Promise<TeamStatistics[]> {
      return [];
    },
    async lineups(): Promise<Lineup[]> {
      return [];
    },
    async team(): Promise<TeamProfile | null> {
      return null;
    },
    async upcomingFixtures(): Promise<MatchSummary[]> {
      return [];
    },
    async squad(): Promise<SquadPlayer[]> {
      return [];
    },
    async competitions(): Promise<CompetitionSummary[]> {
      return [];
    },
  };
}
