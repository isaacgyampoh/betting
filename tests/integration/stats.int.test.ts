import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createApiFootballProvider, StatsPlanLimitError, StatsRateLimitError } from "@/lib/stats/api-football";
import { sampleStatsProvider } from "@/lib/stats/sample";
import { FORM_GAMES, getMatchDetail, listMatches, lookupMatch } from "@/lib/services/stats";
import { createSportyBetAdapter } from "@/lib/bookmakers/sportybet";
import { createUser } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("API-Football client caching", () => {
  it("caches responses in Postgres and serves stale data when the API fails", async () => {
    await db.statsCache.deleteMany();
    const body = {
      errors: [],
      response: [
        {
          fixture: { id: 999, date: "2026-10-05T14:00:00+00:00", status: { short: "NS", long: "Not Started", elapsed: null } },
          league: { id: 39, name: "Premier League", country: "England", logo: null, season: 2026 },
          teams: { home: { id: 1, name: "Arsenal", logo: null }, away: { id: 2, name: "Chelsea", logo: null } },
          goals: { home: null, away: null },
        },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createApiFootballProvider("test-key");

    expect((await provider.fixture(999))?.home.name).toBe("Arsenal");
    expect((await provider.fixture(999))?.home.name).toBe("Arsenal");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]).toEqual([expect.stringContaining("/fixtures?id=999"), expect.objectContaining({ headers: { "x-apisports-key": "test-key" } })]);

    // Expire the cache, then make the API fail: stale data is returned instead of an error.
    // Ten minutes expired, not epoch. Staleness is only servable inside an hour - a score that is
    // three days old is not "slightly out of date", it is a scoreboard showing finished matches
    // still in play, which is the exact failure this grace window exists to prevent.
    const failing = () => new Response(JSON.stringify({ errors: { requests: "limit reached" }, response: [] }));
    await db.statsCache.updateMany({ data: { expiresAt: new Date(Date.now() - 10 * 60_000) } });
    vi.stubGlobal("fetch", vi.fn(async () => failing()));
    expect((await provider.fixture(999))?.home.name).toBe("Arsenal");

    // Past the window, the same cached row is no longer an acceptable answer.
    await db.statsCache.updateMany({ data: { expiresAt: new Date(Date.now() - 3 * 60 * 60_000) } });
    vi.stubGlobal("fetch", vi.fn(async () => failing()));
    await expect(provider.fixture(999)).rejects.toMatchObject({ code: "STATS_UNAVAILABLE" });
  });

  // Building a slip researches a shortlist at once, and fixtures in the same league want the same
  // league data. Nothing is in the cache yet when they all ask, so without this they each fetch it.
  it("makes one request when the same call is already in the air", async () => {
    await db.statsCache.deleteMany();
    const body = {
      errors: [],
      response: [
        {
          fixture: { id: 777, date: "2026-10-05T14:00:00+00:00", status: { short: "NS", long: "Not Started", elapsed: null } },
          league: { id: 39, name: "Premier League", country: "England", logo: null, season: 2026 },
          teams: { home: { id: 1, name: "Arsenal", logo: null }, away: { id: 2, name: "Chelsea", logo: null } },
          goals: { home: null, away: null },
        },
      ],
    };
    let resolve: () => void = () => {};
    const held = new Promise<void>((r) => (resolve = r));
    const fetchMock = vi.fn(async () => {
      await held;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createApiFootballProvider("test-key");

    const all = Promise.all([provider.fixture(777), provider.fixture(777), provider.fixture(777)]);
    await new Promise((r) => setTimeout(r, 10)); // all three are now waiting on the same request
    resolve();
    const results = await all;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(results.map((f) => f?.home.name)).toEqual(["Arsenal", "Arsenal", "Arsenal"]);

    // The entry is dropped once it settles, so this is a coalescer and not a second cache: a later
    // call still goes through the Postgres cache, and a failure is never remembered as a result.
    expect((await provider.fixture(777))?.home.name).toBe("Arsenal");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not hold a failed call against the next one", async () => {
    await db.statsCache.deleteMany();
    const fail = vi.fn(async () => new Response(JSON.stringify({ errors: { bug: "boom" }, response: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fail);
    const provider = createApiFootballProvider("test-key");
    await expect(provider.fixture(778)).rejects.toThrow();
    await expect(provider.fixture(778)).rejects.toThrow();
    expect(fail).toHaveBeenCalledTimes(2);
  });

  // The provider's wording is not ours: a goal, an own goal, a penalty and a missed penalty all
  // arrive as type "Goal" and are told apart by `detail`, and a second yellow is a "Card".
  it("maps the provider's event wording to our types, and keeps the side right", async () => {
    await db.statsCache.deleteMany();
    const ev = (type: string, detail: string, teamId: number, elapsed: number, extra: number | null = null) => ({
      time: { elapsed, extra },
      team: { id: teamId },
      player: { name: "A Player" },
      assist: { name: null },
      type,
      detail,
    });
    const body = {
      errors: [],
      response: [
        ev("Goal", "Normal Goal", 1, 23),
        ev("Goal", "Own Goal", 2, 40),
        ev("Goal", "Penalty", 1, 55),
        ev("Goal", "Missed Penalty", 2, 60),
        ev("Card", "Yellow Card", 2, 12),
        ev("Card", "Second Yellow card", 1, 70),
        ev("Card", "Red Card", 2, 80),
        ev("subst", "Substitution 1", 1, 46),
        ev("Var", "Goal cancelled", 2, 90, 2),
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    const events = await createApiFootballProvider("k").events(555, /* home */ 1);

    expect(events.map((e) => e.type)).toEqual([
      "YELLOW", "GOAL", "OWN_GOAL", "SUBSTITUTION", "PENALTY", "PENALTY_MISSED", "SECOND_YELLOW", "RED", "VAR",
    ]);
    // Sorted by minute, then by added time.
    expect(events.map((e) => e.minute)).toEqual([12, 23, 40, 46, 55, 60, 70, 80, 90]);
    expect(events.at(-1)).toMatchObject({ extra: 2, detail: "Goal cancelled" });
    // Team 1 is the home side, so everything else is away.
    expect(events.filter((e) => e.side === "HOME").map((e) => e.minute)).toEqual([23, 46, 55, 70]);
  });

  it("reads a competition's coverage from the provider rather than assuming it", async () => {
    await db.statsCache.deleteMany();
    const body = {
      errors: [],
      response: [
        {
          seasons: [
            { year: 2025, current: false, coverage: { standings: true, fixtures: { events: true, lineups: true, statistics_fixtures: true, statistics_players: true } } },
            // The Ghana Premier League's real shape: a timeline and a table, no shot counts.
            { year: 2026, current: true, coverage: { standings: true, fixtures: { events: true, lineups: true, statistics_fixtures: false, statistics_players: false } } },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    const provider = createApiFootballProvider("k");
    expect(await provider.coverage(570, 2026)).toEqual({
      events: true,
      lineups: true,
      statistics: false,
      playerStats: false,
      standings: true,
    });
    // An unknown season falls back to the current one rather than inventing coverage.
    expect(await provider.coverage(570, 1999)).toMatchObject({ statistics: false });
  });

  it("raises STATS_UNAVAILABLE when the API fails with nothing cached", async () => {
    await db.statsCache.deleteMany();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(createApiFootballProvider("k").fixture(1)).rejects.toMatchObject({ code: "STATS_UNAVAILABLE" });
  });
});

describe("API-Football plan limits", () => {
  const PLAN_ERROR = { errors: { plan: "Free plans do not have access to the Last parameter." }, response: [] };

  /** Answers /status with the given plan, and every other endpoint with a plan error. */
  function mockApi(plan: string | null) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/status")) {
        return new Response(JSON.stringify({ response: { subscription: { plan, active: true } } }));
      }
      return new Response(JSON.stringify(PLAN_ERROR));
    });
    vi.stubGlobal("fetch", fetchMock);
    // /status does not count against the daily quota, so only data calls are worth counting.
    return { fetchMock, dataCalls: () => calls.filter((u) => !u.includes("/status")) };
  }

  it("raises StatsPlanLimitError and doesn't ask the API for that data again", async () => {
    await db.statsCache.deleteMany();
    const { dataCalls } = mockApi("Free");
    const provider = createApiFootballProvider("k");
    await expect(provider.lastFixtures(33, 5)).rejects.toBeInstanceOf(StatsPlanLimitError);
    await expect(provider.lastFixtures(33, 5)).rejects.toBeInstanceOf(StatsPlanLimitError);
    expect(dataCalls()).toHaveLength(1);
  });

  it("remembers a plan gap for every team, not just the one that was asked", async () => {
    await db.statsCache.deleteMany();
    const { dataCalls } = mockApi("Free");
    const provider = createApiFootballProvider("k");
    await expect(provider.lastFixtures(33, 5)).rejects.toBeInstanceOf(StatsPlanLimitError);
    await expect(provider.lastFixtures(47, 5)).rejects.toBeInstanceOf(StatsPlanLimitError); // different team
    expect(dataCalls()).toHaveLength(1);
  });

  // Upgrading the plan has to take effect at once. Leaving a recorded limit in place meant paying
  // for a plan and still getting no stats until the marker expired.
  it("clears a recorded limit once the subscription has changed", async () => {
    await db.statsCache.deleteMany();
    mockApi("Free");
    const onFree = createApiFootballProvider("k");
    await expect(onFree.lastFixtures(33, 5)).rejects.toBeInstanceOf(StatsPlanLimitError);
    expect(await db.statsCache.count({ where: { key: "capability:fixtures-last" } })).toBe(1);

    // Same key, now on Pro: the limit must be forgotten and the data fetched again.
    await db.statsCache.deleteMany({ where: { key: "apifootball:plan" } }); // plan name is cached briefly
    const fixtures = { response: [{ fixture: { id: 7, date: "2026-10-01T12:00:00+00:00", status: { short: "NS", long: "Not Started", elapsed: null } }, league: { id: 1, name: "L", country: "C", logo: null, season: 2026 }, teams: { home: { id: 33, name: "Arsenal", logo: null }, away: { id: 47, name: "Spurs", logo: null } }, goals: { home: null, away: null } }] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/status")
        ? new Response(JSON.stringify({ response: { subscription: { plan: "Pro", active: true } } }))
        : new Response(JSON.stringify(fixtures)),
    ));
    const onPro = createApiFootballProvider("k");
    expect(await onPro.lastFixtures(33, 5)).toHaveLength(1);
    expect(await db.statsCache.count({ where: { key: "capability:fixtures-last" } })).toBe(0);
  });

  it("per-minute rate limit: busy error with nothing cached, stale data when cached", async () => {
    await db.statsCache.deleteMany();
    const limited = () => new Response(JSON.stringify({ errors: { rateLimit: "Too many requests." }, response: [] }));
    vi.stubGlobal("fetch", vi.fn(async () => limited()));
    await expect(createApiFootballProvider("k").fixturesByDate("2026-10-01")).rejects.toBeInstanceOf(StatsRateLimitError);

    const day = { errors: [], response: [{
      fixture: { id: 7, date: "2026-10-01T19:00:00Z", status: { short: "NS", long: "Not Started", elapsed: null } },
      league: { id: 39, name: "Premier League", country: "England", logo: null, season: 2026 },
      teams: { home: { id: 1, name: "Arsenal", logo: null }, away: { id: 2, name: "Chelsea", logo: null } },
      goals: { home: null, away: null },
    }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(day))));
    await createApiFootballProvider("k").fixturesByDate("2026-10-01");
    // Freshly expired, so still inside the hour that makes stale data better than nothing.
    await db.statsCache.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });
    vi.stubGlobal("fetch", vi.fn(async () => limited()));
    expect((await createApiFootballProvider("k").fixturesByDate("2026-10-01"))[0].id).toBe(7);
  });

  it("requests head-to-head without the `last` parameter and keeps the latest finished meetings", async () => {
    await db.statsCache.deleteMany();
    const fx = (id: number, date: string, short: string) => ({
      fixture: { id, date, status: { short, long: short, elapsed: null } },
      league: { id: 39, name: "Premier League", country: "England", logo: null, season: 2025 },
      teams: { home: { id: 33, name: "Man United", logo: null }, away: { id: 47, name: "Tottenham", logo: null } },
      goals: short === "FT" ? { home: 1, away: 0 } : { home: null, away: null },
    });
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ errors: [], response: [fx(1, "2024-01-01T15:00:00Z", "FT"), fx(2, "2026-02-07T15:00:00Z", "FT"), fx(3, "2026-12-01T15:00:00Z", "NS"), fx(4, "2025-05-21T15:00:00Z", "FT")] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const h2h = await createApiFootballProvider("k").headToHead(47, 33, 2);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("last=");
    expect(h2h.map((m) => m.id)).toEqual([2, 4]);
  });
});

describe("stats service (sample provider)", () => {
  it("finds stats for a bookmaker game despite different spellings, and builds the detail", async () => {
    const user = await createUser();
    const slip = await createSportyBetAdapter("mock", { latencyMs: 0 }).loadCode("BC7K2Q");
    const game = slip.selections[0].event; // Manchester United vs Tottenham
    const match = await lookupMatch("Man Utd", "Tottenham Hotspur", game.kickoffAt);
    expect(match?.home.name).toBe("Manchester United");

    const detail = await getMatchDetail(user, match!.id);
    expect(detail.source).toBe("sample");
    expect(detail.form.home.matches).toHaveLength(FORM_GAMES);
    expect(detail.h2h.length).toBeGreaterThan(0);
    expect(detail.standings?.some((r) => r.team.id === match!.home.id)).toBe(true);
  });

  // Researching a slip calls getMatchDetail once per shortlisted pick and reads only the form and
  // the head-to-head. Everything else it was doing per pick - the table, a rate-limit check, a
  // usage row - was round trips to a database in another region for data nobody looked at.
  it("fetches only the sections asked for, and does not meter them", async () => {
    const user = await createUser();
    const slip = await createSportyBetAdapter("mock", { latencyMs: 0 }).loadCode("BC7K2Q");
    const match = await lookupMatch("Man Utd", "Tottenham Hotspur", slip.selections[0].event.kickoffAt);

    const research = await getMatchDetail(user, match!.id, undefined, { sections: ["form", "h2h"], meter: false });
    expect(research.form.home.matches).toHaveLength(FORM_GAMES);
    expect(research.h2h.length).toBeGreaterThan(0);
    expect(research.standings).toBeNull();
    expect(await db.usageLog.count({ where: { userId: user.id, kind: "STATS" } })).toBe(0);

    // The match page still wants all of it, and is still one metered thing the user did.
    const full = await getMatchDetail(user, match!.id);
    expect(full.standings?.length).toBeGreaterThan(0);
    expect(await db.usageLog.count({ where: { userId: user.id, kind: "STATS" } })).toBe(1);
  });

  it("lists matches grouped by league with the Premier League first", async () => {
    const slip = await createSportyBetAdapter("mock", { latencyMs: 0 }).loadCode("BC7K2Q");
    const date = slip.selections[0].event.kickoffAt.toISOString().slice(0, 10);
    const { groups, source } = await listMatches(date);
    expect(source).toBe("sample");
    expect(groups[0].league).toMatchObject({ country: "England", name: "Premier League" });
    expect(await sampleStatsProvider.fixture(123)).toBeNull();
  });
});

describe("upstream bursts are held below the provider's concurrency floor", () => {
  // Measured against the live Pro key: 10 and 14 simultaneous calls all succeeded, 18 started
  // coming back refused, and 30 lost 8 - each refusal saying "You have exceeded the limit of
  // requests per minute of your subscription" while the quota header still showed ~290 of 300
  // unspent. One match centre fans out to nine calls, so this was reachable with two users.
  it("never lets more than six requests be in flight at once", async () => {
    await db.statsCache.deleteMany();
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return new Response(JSON.stringify({ errors: [], response: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createApiFootballProvider("k");

    // Twenty distinct fixtures, so the in-flight dedupe cannot collapse them into one call.
    await Promise.all(Array.from({ length: 20 }, (_, i) => provider.events(9000 + i, 1).catch(() => [])));

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("retries a burst refusal instead of emptying the panel", async () => {
    await db.statsCache.deleteMany();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        // Refused once, exactly as a colliding burst does, then served.
        if (call === 1) {
          return new Response(
            JSON.stringify({
              errors: { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." },
              response: [],
            }),
          );
        }
        return new Response(JSON.stringify({ errors: [], response: [] }), { status: 200 });
      }),
    );

    await expect(createApiFootballProvider("k").events(4242, 1)).resolves.toEqual([]);
    expect(call).toBe(2);
  });

  it("still gives up, rather than retrying for ever, when the refusal does not clear", async () => {
    await db.statsCache.deleteMany();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ errors: { rateLimit: "Too many requests." }, response: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiFootballProvider("k").fixturesByDate("2026-10-02")).rejects.toBeInstanceOf(StatsRateLimitError);
    // The first attempt plus two retries, and no more.
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it("carries the provider's own wording, which names the limit that was hit", async () => {
    await db.statsCache.deleteMany();
    const message = "Too many requests. You have exceeded the limit of requests per minute of your subscription.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: { rateLimit: message }, response: [] }))));

    await createApiFootballProvider("k")
      .fixturesByDate("2026-10-03")
      .then(
        () => expect.unreachable("should have been refused"),
        (err: unknown) => {
          expect(err).toBeInstanceOf(StatsRateLimitError);
          expect((err as StatsRateLimitError).providerMessage).toBe(message);
        },
      );
  });
});

describe("a competition is asked only for what it carries", () => {
  // API-Football publishes per-season coverage flags and they are honest: the CAF Champions
  // League reports statistics_fixtures false and standings false, and every one of those calls
  // does come back 200 with results=0. Three wasted upstream calls per match open, on a budget of
  // 300 a minute shared by the whole product.
  const league = (id: number, cover: Record<string, unknown>, standings: boolean) => ({
    league: { id, name: "Some Cup", type: "Cup", logo: null },
    country: { name: "World", code: null, flag: null },
    seasons: [{ year: 2026, current: true, coverage: { fixtures: cover, standings } }],
  });

  const seenFor = async (cover: Record<string, unknown>, standings: boolean, status = "FT") => {
    await db.statsCache.deleteMany();
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      seen.push(new URL(u).pathname);
      if (u.includes("/leagues?id=")) {
        return new Response(JSON.stringify({ errors: [], response: [league(12, cover, standings)] }));
      }
      return new Response(JSON.stringify({ errors: [], response: [] }));
    }));
    const provider = createApiFootballProvider("k");
    const cov = await provider.coverage(12, 2026);
    return { seen, cov, status };
  };

  it("reads the flags a competition publishes", async () => {
    const { cov } = await seenFor({ events: true, lineups: true, statistics_fixtures: false, statistics_players: false }, false);
    expect(cov).toEqual({ events: true, lineups: true, statistics: false, playerStats: false, standings: false });
  });

  it("reads a fully covered competition too", async () => {
    const { cov } = await seenFor({ events: true, lineups: true, statistics_fixtures: true, statistics_players: true }, true);
    expect(cov).toEqual({ events: true, lineups: true, statistics: true, playerStats: true, standings: true });
  });

  it("costs one request, then nothing for a day", async () => {
    await db.statsCache.deleteMany();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [], response: [league(12, { events: true, lineups: true, statistics_fixtures: false }, false)] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createApiFootballProvider("k");
    await provider.coverage(12, 2026);
    await provider.coverage(12, 2026);
    await provider.coverage(12, 2026);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
