import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

/**
 * Daily Special Picks against a real database.
 *
 * The unit tests cover what may be published and how it is judged. These cover the things only a
 * database can show: that a rerun cannot duplicate, that grading reads the match rather than
 * guessing, and that the published record is not quietly flattered.
 */
const DATE = "2026-11-02";

const base = {
  forDate: new Date(DATE),
  statsFixtureId: 1001,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  competition: "Premier League",
  country: "England",
  kickoffAt: new Date("2026-11-02T12:00:00Z"),
  marketKind: "CORNERS",
  marketSide: "MATCH",
  marketPeriod: "FT",
  line: 9.5,
  outcome: "OVER",
  bookmaker: "sportybet",
  rawMarketName: "Corners - Over/Under",
  odds: 1.9,
  oddsCheckedAt: new Date(),
  probability: 0.72,
  confidence: "medium",
  rating: 62,
  reason: "Over 9.5 in 6 of 8.",
  evidence: {},
  researchedAt: new Date(),
};

beforeEach(async () => {
  await db.specialPick.deleteMany({});
});
afterEach(() => vi.unstubAllGlobals());

describe("a rerun cannot publish the same thing twice", () => {
  // The brief asks for idempotency by name. It is a database constraint rather than a code path,
  // because a check-then-insert races with itself and a constraint does not.
  it("refuses a second row for the same fixture, market and day", async () => {
    await db.specialPick.create({ data: { ...base, position: 1 } });
    await expect(db.specialPick.create({ data: { ...base, position: 2 } })).rejects.toThrow();
    expect(await db.specialPick.count()).toBe(1);
  });

  it("refuses a second row in the same daily slot", async () => {
    await db.specialPick.create({ data: { ...base, position: 1 } });
    await expect(
      db.specialPick.create({ data: { ...base, position: 1, statsFixtureId: 2002, homeTeam: "Spurs" } }),
    ).rejects.toThrow();
  });

  // Two different fixtures in two different slots is the normal case.
  it("allows two selections from different matches", async () => {
    await db.specialPick.create({ data: { ...base, position: 1 } });
    await db.specialPick.create({ data: { ...base, position: 2, statsFixtureId: 2002, homeTeam: "Spurs", marketKind: "SHOTS" } });
    expect(await db.specialPick.count()).toBe(2);
  });
});

describe("grading reads the match, and refuses to guess", () => {
  /** Stubs the stats provider for one test. */
  async function settleWith(status: string, stats: { corners: number | null }[] | null) {
    const blank = {
      possession: null, shotsTotal: null, shotsOnGoal: null, shotsOffGoal: null, shotsBlocked: null,
      shotsInsideBox: null, shotsOutsideBox: null, offsides: null, fouls: null, yellowCards: null,
      redCards: null, saves: null, passesTotal: null, passesAccurate: null, expectedGoals: null,
    };
    vi.doMock("@/lib/services/stats", () => ({
      statsProvider: () => ({
        fixture: async () => ({ id: 1001, status, home: { id: 1, name: "Arsenal", logo: null }, away: { id: 2, name: "Chelsea", logo: null } }),
        statistics: async () =>
          stats === null ? [] : stats.map((s, i) => ({ team: { id: i + 1, name: "T", logo: null }, ...blank, corners: s.corners })),
      }),
    }));
    vi.resetModules();
    const { settleSpecialPicks } = await import("@/lib/services/settle-special");
    const result = await settleSpecialPicks(new Date("2026-11-02T12:00:00Z"));
    vi.doUnmock("@/lib/services/stats");
    return result;
  }

  it("marks an over that landed as won, and records the count", async () => {
    await db.specialPick.create({ data: { ...base, position: 1, kickoffAt: new Date("2026-11-01T12:00:00Z") } });
    const r = await settleWith("FINISHED", [{ corners: 6 }, { corners: 5 }]); // 11 > 9.5
    expect(r.settled).toBe(1);
    const row = await db.specialPick.findFirstOrThrow({});
    expect(row.status).toBe("WON");
    expect(Number(row.actual)).toBe(11);
    expect(row.settledAt).not.toBeNull();
  });

  it("marks an over that missed as lost", async () => {
    await db.specialPick.create({ data: { ...base, position: 1, kickoffAt: new Date("2026-11-01T12:00:00Z") } });
    await settleWith("FINISHED", [{ corners: 4 }, { corners: 4 }]); // 8 < 9.5
    expect((await db.specialPick.findFirstOrThrow({})).status).toBe("LOST");
  });

  it("voids a postponed match rather than grading it", async () => {
    await db.specialPick.create({ data: { ...base, position: 1, kickoffAt: new Date("2026-11-01T12:00:00Z") } });
    const r = await settleWith("POSTPONED", null);
    expect(r.voided).toBe(1);
    expect((await db.specialPick.findFirstOrThrow({})).status).toBe("VOID");
  });

  // The failure this guards against: a missing count read as zero marks every over as lost,
  // silently and permanently.
  it("leaves a finished match with no statistics pending, not lost", async () => {
    await db.specialPick.create({ data: { ...base, position: 1, kickoffAt: new Date("2026-11-01T12:00:00Z") } });
    const r = await settleWith("FINISHED", [{ corners: null }, { corners: 5 }]);
    expect(r.settled).toBe(0);
    expect(r.waiting).toBe(1);
    expect((await db.specialPick.findFirstOrThrow({})).status).toBe("PENDING");
  });

  it("does not touch a match that has only just finished", async () => {
    // Inside the settle window, so it is not even looked at.
    await db.specialPick.create({ data: { ...base, position: 1, kickoffAt: new Date("2026-11-02T11:00:00Z") } });
    const r = await settleWith("FINISHED", [{ corners: 9 }, { corners: 9 }]);
    expect(r.settled).toBe(0);
    expect((await db.specialPick.findFirstOrThrow({})).status).toBe("PENDING");
  });

  // The record is a record.
  it("never re-grades a selection that is already settled", async () => {
    await db.specialPick.create({
      data: { ...base, position: 1, kickoffAt: new Date("2026-11-01T12:00:00Z"), status: "WON", actual: 11, settledAt: new Date() },
    });
    const r = await settleWith("FINISHED", [{ corners: 1 }, { corners: 1 }]); // would now be a loss
    expect(r.settled).toBe(0);
    const row = await db.specialPick.findFirstOrThrow({});
    expect(row.status).toBe("WON");
    expect(Number(row.actual)).toBe(11);
  });
});

describe("the published record is not flattered", () => {
  it("counts losses, and takes the win rate over settled selections only", async () => {
    await db.specialPick.createMany({
      data: [
        { ...base, position: 1, status: "WON", odds: 2.0 },
        { ...base, position: 2, statsFixtureId: 2, marketKind: "SHOTS", status: "LOST", odds: 1.9 },
        { ...base, forDate: new Date("2026-11-01"), position: 1, statsFixtureId: 3, status: "VOID", odds: 1.8 },
        { ...base, forDate: new Date("2026-11-01"), position: 2, statsFixtureId: 4, status: "PENDING", odds: 2.2 },
      ],
    });
    const { specialPerformance } = await import("@/lib/services/special-picks");
    const p = await specialPerformance();

    expect(p.total).toBe(4);
    expect(p.won).toBe(1);
    expect(p.lost).toBe(1);
    expect(p.void).toBe(1);
    expect(p.pending).toBe(1);
    // One from two settled. The void is neither a win nor a loss and is reported as itself.
    expect(p.winRate).toBeCloseTo(0.5, 5);
  });

  it("computes profit from the price actually published", async () => {
    await db.specialPick.createMany({
      data: [
        { ...base, position: 1, status: "WON", odds: 2.5 }, // +1.5
        { ...base, position: 2, statsFixtureId: 2, status: "LOST", odds: 1.9 }, // -1
      ],
    });
    const { specialPerformance } = await import("@/lib/services/special-picks");
    const p = await specialPerformance();
    expect(p.profitUnits).toBeCloseTo(0.5, 5);
    expect(p.stakedUnits).toBe(2);
  });

  // Dropping these from the denominator would be exactly the flattering arithmetic to avoid.
  it("reports selections published without a price rather than hiding them", async () => {
    await db.specialPick.createMany({
      data: [
        { ...base, position: 1, status: "WON", odds: null, bookmaker: null },
        { ...base, position: 2, statsFixtureId: 2, status: "LOST", odds: 1.9 },
      ],
    });
    const { specialPerformance } = await import("@/lib/services/special-picks");
    const p = await specialPerformance();
    expect(p.unpriced).toBe(1);
    expect(p.stakedUnits).toBe(1);
    expect(p.total).toBe(2);
    expect(p.winRate).toBeCloseTo(0.5, 5);
  });

  it("has no win rate at all before anything is settled", async () => {
    await db.specialPick.create({ data: { ...base, position: 1, status: "PENDING" } });
    const { specialPerformance } = await import("@/lib/services/special-picks");
    expect((await specialPerformance()).winRate).toBeNull();
  });
});
