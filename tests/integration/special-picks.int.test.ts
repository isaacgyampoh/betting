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

/**
 * A published day: the slip and its legs.
 *
 * The record counts slips, so a test that creates only legs is testing nothing - the arithmetic it
 * is checking reads from `special_slips`.
 */
async function publish(
  date: string,
  legs: { status: string; odds: number | null; kind?: string }[],
  slipStatus = "PENDING",
) {
  const slip = await db.specialSlip.create({
    data: {
      forDate: new Date(date),
      reference: `GC${date.slice(2).replace(/-/g, "")}`,
      combinedOdds: legs.reduce((t, l) => t * (l.odds ?? 1), 1),
      target: 2,
      summary: "Test slip.",
      status: slipStatus as never,
    },
  });

  for (const [i, leg] of legs.entries()) {
    await db.specialPick.create({
      data: {
        ...base,
        slipId: slip.id,
        forDate: new Date(date),
        position: i + 1,
        statsFixtureId: 1000 + i,
        marketKind: leg.kind ?? "CORNERS",
        status: leg.status as never,
        odds: leg.odds,
        bookmaker: leg.odds === null ? null : "sportybet",
      },
    });
  }
  return slip;
}

beforeEach(async () => {
  await db.specialSlip.deleteMany({}); // cascades to its legs
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

/**
 * The day is the bet.
 *
 * Two selections published together are one slip staked once, so the record counts days, not
 * selections. Counting them separately described a product nobody has - and flattered it, because
 * a day where one leg won and the other lost reads as 50% rather than as the loss it was.
 */
/**
 * The slip is the bet.
 *
 * Two or three selections published together are one accumulator staked once, so the record counts
 * slips. Counting legs separately described a product nobody has and flattered it: a day where one
 * leg won and another lost read as 50% rather than as the loss it was.
 */
describe("the published record is not flattered", () => {
  const perf = async () => (await import("@/lib/services/special-picks")).specialPerformance();

  it("loses the whole slip when one leg loses", async () => {
    await publish(DATE, [{ status: "WON", odds: 1.45 }, { status: "LOST", odds: 1.4, kind: "SHOTS" }], "LOST");
    const p = await perf();

    expect(p.total).toBe(1); // one slip
    expect(p.lost).toBe(1);
    expect(p.won).toBe(0);
    expect(p.winRate).toBe(0);
    expect(p.profitUnits).toBeCloseTo(-1, 5);
    // The legs are still reported, because a slip hides which one was wrong.
    expect(p.legs).toMatchObject({ total: 2, won: 1, lost: 1 });
  });

  it("wins only when every leg wins, and pays the combined price", async () => {
    await publish(DATE, [{ status: "WON", odds: 1.45 }, { status: "WON", odds: 1.4, kind: "SHOTS" }], "WON");
    const p = await perf();

    expect(p.won).toBe(1);
    expect(p.winRate).toBe(1);
    // 1.45 x 1.40 = 2.03, so one unit returns 1.03.
    expect(p.profitUnits).toBeCloseTo(1.03, 5);
    expect(p.stakedUnits).toBe(1);
  });

  it("pays a three-leg slip at all three prices", async () => {
    await publish(
      DATE,
      [
        { status: "WON", odds: 1.27 },
        { status: "WON", odds: 1.27, kind: "SHOTS" },
        { status: "WON", odds: 1.27, kind: "SHOTS_ON_TARGET" },
      ],
      "WON",
    );
    const p = await perf();
    // 1.27 cubed is 2.048; profit is reported to the penny, so 1.05.
    expect(p.profitUnits).toBeCloseTo(1.05, 5);
    expect(p.legs.total).toBe(3);
  });

  // A bookmaker's rule, not one to invent: a void leg drops out at 1.00 rather than sinking a slip.
  it("drops a void leg out instead of losing the slip", async () => {
    await publish(DATE, [{ status: "WON", odds: 2.4 }, { status: "VOID", odds: 1.6, kind: "SHOTS" }], "WON");
    const p = await perf();

    expect(p.won).toBe(1);
    expect(p.profitUnits).toBeCloseTo(1.4, 5); // the surviving leg alone
    expect(p.legs.void).toBe(1);
  });

  it("voids a slip whose legs all voided", async () => {
    await publish(DATE, [{ status: "VOID", odds: 1.45 }, { status: "VOID", odds: 1.4 }], "VOID");
    const p = await perf();

    expect(p.void).toBe(1);
    expect(p.winRate).toBeNull();
    expect(p.stakedUnits).toBe(0);
  });

  it("leaves a slip running while any leg is", async () => {
    await publish(DATE, [{ status: "WON", odds: 1.45 }, { status: "PENDING", odds: 1.4 }]);
    const p = await perf();

    expect(p.pending).toBe(1);
    expect(p.won).toBe(0);
    expect(p.winRate).toBeNull();
  });

  // Dropping these from the denominator would be exactly the flattering arithmetic to avoid.
  it("reports a slip it could not price rather than hiding it", async () => {
    await publish(DATE, [{ status: "WON", odds: null }, { status: "WON", odds: 1.4 }], "WON");
    const p = await perf();

    expect(p.unpriced).toBe(1);
    expect(p.stakedUnits).toBe(0);
    expect(p.won).toBe(1); // it still won; it just cannot be scored in units
    expect(p.winRate).toBe(1);
  });

  it("counts settled slips apart from running ones", async () => {
    await publish(DATE, [{ status: "WON", odds: 1.45 }, { status: "WON", odds: 1.4 }], "WON");
    await publish("2026-11-01", [{ status: "PENDING", odds: 1.5 }, { status: "PENDING", odds: 1.4 }]);
    const p = await perf();

    expect(p.total).toBe(2);
    expect(p.won).toBe(1);
    expect(p.pending).toBe(1);
    expect(p.winRate).toBe(1); // over settled slips only
  });

  it("has no win rate at all before anything is settled", async () => {
    await publish(DATE, [{ status: "PENDING", odds: 1.45 }, { status: "PENDING", odds: 1.4 }]);
    expect((await perf()).winRate).toBeNull();
  });
});
