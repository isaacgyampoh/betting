import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listSpecialHistory, listSpecialPicks, specialPerformance } from "@/lib/services/special-picks";
import { ghanaDate } from "@/lib/services/daily-picks";

/**
 * The website cannot reach Postgres, and these three functions have to know it.
 *
 * gameclaw.win runs on Cloudflare and `gameclaw-db` accepts no external connections, so every
 * public page on the Worker reads through the API on Render instead - see `remote-data.ts`. These
 * three were written against Prisma directly, which worked everywhere it was tested and would
 * have returned 500 on the one host that actually serves the record page.
 *
 * Each test proves which source answered by making them disagree: the database is empty and the
 * stubbed API is not, so a result with rows in it can only have come over the wire.
 */
const API = "https://api.example.test/api/v1";

/** A published selection as the endpoint serializes one. */
const remotePick = {
  position: 1,
  match: {
    home: "Arsenal",
    away: "Chelsea",
    competition: "Premier League",
    country: "England",
    kickoffAt: "2026-11-03T15:00:00.000Z",
  },
  market: { kind: "CORNERS", side: "MATCH", label: "Match corners", line: 9.5, outcome: "OVER" },
  price: { bookmaker: "sportybet", odds: 1.9, checkedAt: "2026-11-03T07:00:00.000Z" },
  probability: 0.721,
  confidence: "medium",
  reason: "Over 9.5 in 7 of 8.",
  evidence: {},
  researchedAt: "2026-11-03T07:00:00.000Z",
  status: "PENDING",
  actual: null,
};

const requested: string[] = [];

/** Stands in for the API. Records what was asked for, so the query string can be asserted. */
function stubApi(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ data: body }), {
        status: ok ? 200 : 503,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

beforeEach(async () => {
  requested.length = 0;
  await db.specialPick.deleteMany({});
  vi.stubEnv("GC_DATA_API_BASE", API);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("on the Worker, where only the API can reach the database", () => {
  it("reads today's selections over the wire, not from Postgres", async () => {
    stubApi({ picks: [remotePick], performance: { total: 1 } });

    const picks = await listSpecialPicks();

    expect(picks).toHaveLength(1);
    expect(picks[0].match.home).toBe("Arsenal");
    expect(requested).toEqual([`${API}/special-picks`]);
  });

  it("reads the record over the wire", async () => {
    stubApi({ picks: [], performance: { total: 5, won: 1, lost: 1, void: 1, pending: 2, winRate: 0.5 } });

    const record = await specialPerformance();

    expect(record.total).toBe(5);
    expect(record.winRate).toBe(0.5);
    expect(requested).toEqual([`${API}/special-picks`]);
  });

  // The history is opt-in, so the one caller that needs it has to ask for it by name.
  it("asks for the history explicitly", async () => {
    stubApi({ picks: [], performance: { total: 0 }, history: [{ date: "2026-11-02", picks: [remotePick] }] });

    const history = await listSpecialHistory();

    expect(history).toHaveLength(1);
    expect(history[0].date).toBe("2026-11-02");
    expect(requested).toEqual([`${API}/special-picks?history=1`]);
  });

  // Only today is published by that endpoint, so any other date must not be answered from it.
  it("does not answer a past date from today's endpoint", async () => {
    stubApi({ picks: [remotePick], performance: { total: 1 } });

    const picks = await listSpecialPicks("2026-10-01");

    expect(picks).toEqual([]);
    expect(requested).toEqual([]);
  });

  // The fallback then fails too on the Worker, which is correct and visible. What it must not do
  // is turn a blip into a thrown error before the caller can see one.
  it("falls through to the database when the API refuses", async () => {
    stubApi({}, false);
    const picks = await listSpecialPicks();

    expect(picks).toEqual([]);
    expect(requested).toEqual([`${API}/special-picks`]);
  });
});

describe("on Render, where the database is right there", () => {
  beforeEach(() => vi.stubEnv("GC_DATA_API_BASE", ""));

  it("goes straight to Postgres and makes no request", async () => {
    stubApi({ picks: [remotePick], performance: { total: 99 } });

    await db.specialPick.create({
      data: {
        forDate: new Date(ghanaDate()),
        position: 1,
        statsFixtureId: 777,
        homeTeam: "Local",
        awayTeam: "Database",
        competition: "Premier League",
        country: "England",
        kickoffAt: new Date(),
        marketKind: "CORNERS",
        marketSide: "MATCH",
        marketPeriod: "FT",
        line: 9.5,
        outcome: "OVER",
        bookmaker: "sportybet",
        rawMarketName: "Corners - Over/Under",
        odds: 1.9,
        oddsCheckedAt: new Date(),
        probability: 0.7,
        confidence: "medium",
        rating: 60,
        reason: "From the database.",
        evidence: {},
        researchedAt: new Date(),
      },
    });

    const picks = await listSpecialPicks();
    const record = await specialPerformance();

    expect(picks[0].match.home).toBe("Local");
    expect(record.total).toBe(1);
    expect(requested).toEqual([]);
  });
});
