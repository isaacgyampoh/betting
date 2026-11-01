import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  CompetitionSummary,
  LeagueCoverage,
  Lineup,
  LineupPlayer,
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

/**
 * A score, from a provider that is not consistent about their type.
 *
 * `/fixtures/date/:date` returns `homeTeamScore` as a number or null; `/teams/:id/results` returns
 * the same field as the string "1". Passing that straight into `goals.home`, which is typed
 * `number | null`, type-checks because it arrives as JSON `any` and then compares and sorts
 * wrongly for ever after.
 */
function score(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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
   *
   * Written in one batch, and skipped entirely for ids this process has already stored. The first
   * version did an upsert per team and per league inside the per-fixture mapper, which is three
   * round trips to Frankfurt for every fixture: a 1,149-fixture day was about 3,400 of them and
   * `/api/v1/matches` took **69 seconds**, cached or not - the HTTP cache spared the twelve
   * provider calls but the mapper ran over the cached payload all the same. Measured on the live
   * service, not reasoned about.
   */
  const persisted = new Set<string>();

  async function rememberAll(pairs: { kind: "team" | "league"; apiId: number | null; cuid: string }[]) {
    const rows = [];
    for (const { kind, apiId, cuid } of pairs) {
      if (!apiId || !cuid) continue;
      const key = `goal:map:${kind}:${apiId}`;
      if (persisted.has(key)) continue;
      persisted.add(key);
      rows.push({
        key,
        endpoint: `map/${kind}`,
        params: {},
        payload: { cuid } as never,
        expiresAt: new Date(Date.now() + ID_MAP_TTL_MS),
      });
    }
    if (!rows.length) return;
    try {
      // skipDuplicates, not upsert: a mapping never changes, so an existing row is already right
      // and re-writing it would be work for nothing.
      await db.statsCache.createMany({ data: rows, skipDuplicates: true });
    } catch (err) {
      // The map is an optimisation; losing it costs a panel, not the page. But the in-process set
      // must forget these, or a transient failure would be remembered as success for the life of
      // the process and the mapping would never be written again.
      for (const r of rows) persisted.delete(r.key);
      logger.warn("goal.id_map_write_failed", { rows: rows.length, err: String(err) });
    }
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

  /**
   * Null for an entry that cannot be represented, rather than a throw.
   *
   * A single fixture with an unparseable kick-off used to take the whole call down: `new Date(…)`
   * gives Invalid Date, `.toISOString()` throws, and one bad row in 1,149 empties the Live Centre
   * for everybody. Found when the head-to-head endpoint turned out to return a different shape
   * entirely, with no kickoffUtc at all.
   */
  function toMatchSummary(f: GoalFixture): MatchSummary | null {
    const kickoff = new Date(f?.kickoffUtc ?? "");
    if (Number.isNaN(kickoff.getTime())) {
      logger.warn("goal.fixture_unmappable", { apiId: f?.apiId, kickoffUtc: f?.kickoffUtc });
      return null;
    }
    const homeId = apiIdFromAsset(f.teamHomeBadge ?? f.homeTeam?.badge);
    const awayId = apiIdFromAsset(f.teamAwayBadge ?? f.awayTeam?.badge);
    const leagueId = apiIdFromAsset(f.leagueLogo);

    const status = toStatus(f);
    const season = Number(f.leagueYear);
    return {
      id: Number(f.apiId),
      kickoffAt: kickoff.toISOString(),
      status,
      statusLabel: statusLabel(f, status),
      league: {
        id: leagueId ?? 0,
        name: f.leagueName ?? "",
        country: f.countryName ?? "",
        season: Number.isFinite(season) ? season : kickoff.getUTCFullYear(),
        logo: f.leagueLogo ?? null,
      },
      // The nested object carries proper diacritics ("Lanús") where the flat field does not ("Lanus").
      home: { id: homeId ?? 0, name: f.homeTeam?.name ?? f.homeTeamName ?? "", logo: f.teamHomeBadge ?? null },
      away: { id: awayId ?? 0, name: f.awayTeam?.name ?? f.awayTeamName ?? "", logo: f.teamAwayBadge ?? null },
      goals: { home: score(f.homeTeamScore), away: score(f.awayTeamScore) },
      halftime:
        score(f.homeTeamHalftimeScore) === null && score(f.awayTeamHalftimeScore) === null
          ? null
          : { home: score(f.homeTeamHalftimeScore), away: score(f.awayTeamHalftimeScore) },
    };
  }

  async function summaries(list: GoalFixture[]): Promise<MatchSummary[]> {
    const rows = list ?? [];
    const mapped = rows.map(toMatchSummary).filter((m): m is MatchSummary => m !== null);
    // One batched write for the whole list, after the mapping rather than inside it.
    await rememberAll(
      rows.flatMap((f) => [
        { kind: "team" as const, apiId: apiIdFromAsset(f.teamHomeBadge ?? f.homeTeam?.badge), cuid: f.homeTeamId },
        { kind: "team" as const, apiId: apiIdFromAsset(f.teamAwayBadge ?? f.awayTeam?.badge), cuid: f.awayTeamId },
        { kind: "league" as const, apiId: apiIdFromAsset(f.leagueLogo), cuid: f.leagueId },
      ]),
    );
    return mapped;
  }

  /**
   * The two sides of a fixture, for panels whose own payload carries no team names.
   *
   * The statistics and line-up responses identify sides only as "home" and "away", so the fixture
   * is read for the names and badges. It is nearly always already cached - getMatchDetail fetches
   * the fixture before either panel - so this costs no extra request in practice.
   */
  async function teamRefs(fixtureId: number) {
    const f = await call<GoalFixture>(`/fixtures/${fixtureId}`, LIVE_TTL_MS);
    const m = f ? toMatchSummary(f) : null;
    return m ? { home: m.home, away: m.away } : null;
  }

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
      if (!f) return null;
      return (await summaries([f]))[0] ?? null;
    },

    async lastFixtures(teamId, count) {
      const cuid = await resolve("team", teamId);
      if (!cuid) return [];
      const list = await call<GoalFixture[]>(`/teams/${cuid}/results?limit=${count}`, SETTLED_TTL_MS);
      return summaries(list ?? []);
    },

    /**
     * Head to head, which speaks a different language from every other endpoint here.
     *
     * `/h2h/:a/:b/direct` is a passthrough of an older upstream rather than GOAL's own model: the
     * fields are snake_case (`match_id`, `match_hometeam_name`), the badge URLs point at
     * apiv3.apifootball.com, and the status is "Finished" in title case where the fixtures
     * endpoint says "FINISHED". Feeding it through the normal mapper produced
     * `Invalid time value` and took the whole match page down, because there is no kickoffUtc in
     * it at all.
     *
     * One genuine compromise: there is no timezone. `match_date` and `match_time` are composed as
     * UTC, which may be out by the competition's offset. For a list of past meetings that is
     * immaterial - the date is what is read - but it is wrong enough that these must never be
     * used where a precise kick-off matters.
     */
    async headToHead(homeId, awayId, count) {
      const [a, b] = await Promise.all([resolve("team", homeId), resolve("team", awayId)]);
      if (!a || !b) return [];
      type H2H = Record<string, string | null | undefined>;
      const payload = await call<{ matches?: H2H[] }>(`/h2h/${a}/${b}/direct`, SETTLED_TTL_MS);

      const out: MatchSummary[] = [];
      for (const m of (payload?.matches ?? []).slice(0, count)) {
        const date = m.match_date;
        if (!date) continue;
        const kickoff = new Date(`${date}T${m.match_time || "00:00"}:00Z`);
        if (Number.isNaN(kickoff.getTime())) continue;
        const finished = /finish|ft|after/i.test(m.match_status ?? "");
        const season = Number(date.slice(0, 4));
        out.push({
          id: Number(m.match_id) || 0,
          kickoffAt: kickoff.toISOString(),
          status: finished ? "FINISHED" : "SCHEDULED",
          statusLabel: finished ? "FT" : "",
          league: {
            id: Number(m.league_id) || 0,
            name: m.league_name ?? "",
            country: m.country_name ?? "",
            season: Number.isFinite(season) ? season : kickoff.getUTCFullYear(),
            logo: m.league_logo || null,
          },
          // Already numeric here, unlike everywhere else in this API.
          home: { id: Number(m.match_hometeam_id) || 0, name: m.match_hometeam_name ?? "", logo: m.team_home_badge || null },
          away: { id: Number(m.match_awayteam_id) || 0, name: m.match_awayteam_name ?? "", logo: m.team_away_badge || null },
          goals: { home: score(m.match_hometeam_score), away: score(m.match_awayteam_score) },
          halftime:
            score(m.match_hometeam_halftime_score) === null && score(m.match_awayteam_halftime_score) === null
              ? null
              : {
                  home: score(m.match_hometeam_halftime_score),
                  away: score(m.match_awayteam_halftime_score),
                },
        });
      }
      return out;
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

    /**
     * Team statistics, home side first.
     *
     * Two things about this payload took a real match to discover, and both were got wrong first
     * time by sampling a small competition.
     *
     * **There are two tiers of coverage.** A lower-division fixture returns eleven rows - Corners,
     * Throw In, Free Kick, Goal Kick, Penalty, Substitution, Attacks, Dangerous Attacks, On
     * Target, Off Target, Ball Possession. A well-covered one returns twenty-five, adding Shots
     * Total, Shots On/Off Goal, Shots Blocked, Shots Inside/Outside Box, Fouls, Offsides, Yellow
     * Cards, Saves, Passes Total and Passes Accurate. Concluding from the small sample that "GOAL
     * does not report fouls" was simply wrong: it reports them where the competition carries them,
     * which is exactly what a nullable field is for.
     *
     * **Labels repeat, with different values, and the later one is right.** Aston Villa v Fulham
     * carried `Ball Possession` twice: 9%/91% and then 45%/55%. The first is nonsense for a 1-1,
     * and the pass counts settle it - 434 against 536 is 45%. Barcelona v Alaves likewise gave
     * 67%/33% then 77%/23%, against passes of 833 to 242, which is 77%. So the array appends a
     * better-sourced set after a thinner one, and reading the *first* match - which is what
     * `find` does, and what this did - published 9% possession for a match that had 45%.
     *
     * Hence findLast. A wrong number is worse than a missing one, because nothing about it looks
     * wrong on the page.
     *
     * Rows with no field here - Throw In, Free Kick, Goal Kick, Penalty, Substitution, Attacks,
     * Dangerous Attacks - are dropped rather than bent into one that nearly fits. Anything absent
     * stays null, which in this model means "not reported" and renders differently from zero.
     */
    async statistics(fixtureId, _homeTeamId, settled) {
      type Row = { type?: string | null; home?: string | number | null; away?: string | number | null };
      const payload = await call<{ match?: { fullTime?: Row[] }; hasStatistics?: boolean }>(
        `/fixtures/${fixtureId}/statistics`,
        settled ? SETTLED_TTL_MS : LIVE_TTL_MS,
      );
      const rows = payload?.match?.fullTime ?? [];
      if (!payload?.hasStatistics || !rows.length) return [];

      const refs = await teamRefs(fixtureId);
      if (!refs) return [];

      // findLast, not find: see the note above about repeated labels.
      const pick = (side: "home" | "away", ...labels: string[]) => {
        for (const label of labels) {
          const row = rows.findLast((r) => (r.type ?? "").trim().toLowerCase() === label);
          if (row) return score(String(row[side] ?? "").replace("%", "").trim());
        }
        return null;
      };
      const build = (team: typeof refs.home, side: "home" | "away"): TeamStatistics => ({
        team,
        possession: pick(side, "ball possession", "possession"),
        shotsTotal: pick(side, "shots total", "total shots"),
        // Both labels appear on a well-covered match and agree (3/5 on Villa v Fulham); the
        // thin tier carries only "On Target".
        shotsOnGoal: pick(side, "shots on goal", "on target"),
        shotsOffGoal: pick(side, "shots off goal", "off target"),
        shotsBlocked: pick(side, "shots blocked", "blocked shots"),
        shotsInsideBox: pick(side, "shots inside box"),
        shotsOutsideBox: pick(side, "shots outside box"),
        corners: pick(side, "corners", "corner kicks"),
        offsides: pick(side, "offsides"),
        fouls: pick(side, "fouls"),
        yellowCards: pick(side, "yellow cards"),
        redCards: pick(side, "red cards"),
        saves: pick(side, "saves", "goalkeeper saves"),
        passesTotal: pick(side, "passes total", "total passes"),
        passesAccurate: pick(side, "passes accurate", "accurate passes"),
        expectedGoals: pick(side, "expected goals", "xg"),
      });
      return [build(refs.home, "home"), build(refs.away, "away")];
    },

    /**
     * Line-ups, home side first.
     *
     * `hasLineups` is false on a good many fixtures, including some that have finished, and an
     * empty array is the right answer then rather than eleven blanks.
     *
     * `grid` stays null throughout. GOAL has a `lineupPosition` field but it reads "0" for every
     * player in the sample taken, so there is no pitch position in it; the type's own comment says
     * a pitch view must handle null rather than guess a formation, which is exactly this case.
     */
    async lineups(fixtureId, _homeTeamId, settled) {
      type Entry = {
        lineupPlayer?: string | null;
        lineupNumber?: string | null;
        playerKey?: string | null;
        playerPosition?: string | null;
      };
      type Side = { startingLineups?: Entry[]; substitutes?: Entry[]; coach?: Entry[] };
      const payload = await call<{ home?: Side; away?: Side; homeFormation?: string | null; awayFormation?: string | null; hasLineups?: boolean }>(
        `/fixtures/${fixtureId}/lineups`,
        settled ? SETTLED_TTL_MS : LIVE_TTL_MS,
      );
      if (!payload?.hasLineups) return [];

      const refs = await teamRefs(fixtureId);
      if (!refs) return [];

      // "Goalkeepers" / "Defenders" / "Midfielders" / "Forwards" -> the single letter the model uses.
      const letter = (pos: string | null | undefined) => {
        const p = (pos ?? "").trim().toLowerCase();
        if (p.startsWith("goal")) return "G";
        if (p.startsWith("def")) return "D";
        if (p.startsWith("mid")) return "M";
        if (p.startsWith("for") || p.startsWith("att")) return "F";
        return null;
      };
      const player = (e: Entry): LineupPlayer => ({
        id: score(e.playerKey),
        name: e.lineupPlayer ?? "",
        number: score(e.lineupNumber),
        position: letter(e.playerPosition),
        grid: null,
      });
      const build = (team: typeof refs.home, side: Side | undefined, formation: string | null | undefined): Lineup => ({
        team,
        formation: formation || null,
        coach: side?.coach?.[0]?.lineupPlayer ?? null,
        startXI: (side?.startingLineups ?? []).map(player),
        substitutes: (side?.substitutes ?? []).map(player),
      });
      return [
        build(refs.home, payload.home, payload.homeFormation),
        build(refs.away, payload.away, payload.awayFormation),
      ];
    },

    // ------------------------------------------------------------ not yet mapped
    //
    // Every one of these returns an honest empty rather than a guess, and the match page already
    // turns that into a stated "not available" note instead of a blank panel - the mechanism exists
    // because API-Football does not cover every competition either.
    //
    // They are not stubs left for neatness. Each needs a shape decision that wants its own look:
    //
    //   coverage    GOAL publishes no per-competition coverage flags, so there is nothing to read.
    //               Null is correct: it means "the provider does not say", which is true.
    //   team/squad/upcomingFixtures/competitions
    //               Reachable, but each needs its own id-mapping and shape work.
    async coverage(): Promise<LeagueCoverage | null> {
      return null;
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
