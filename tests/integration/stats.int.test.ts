import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createApiFootballProvider } from "@/lib/stats/api-football";
import { sampleStatsProvider } from "@/lib/stats/sample";
import { getMatchDetail, listMatches, lookupMatch } from "@/lib/services/stats";
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
    await db.statsCache.updateMany({ data: { expiresAt: new Date(0) } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: { requests: "limit reached" }, response: [] }))));
    expect((await provider.fixture(999))?.home.name).toBe("Arsenal");
  });

  it("raises STATS_UNAVAILABLE when the API fails with nothing cached", async () => {
    await db.statsCache.deleteMany();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(createApiFootballProvider("k").fixture(1)).rejects.toMatchObject({ code: "STATS_UNAVAILABLE" });
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
    expect(detail.form.home.matches).toHaveLength(5);
    expect(detail.h2h.length).toBeGreaterThan(0);
    expect(detail.standings?.some((r) => r.team.id === match!.home.id)).toBe(true);
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
