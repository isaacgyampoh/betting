import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Observation } from "@/lib/special-picks/assess";

/**
 * Generation end to end, against the real table.
 *
 * Only the three outside edges are stubbed - the bookmaker's priced offers, matching a fixture to
 * the stats provider, and the team research - because those are network calls. Everything the
 * feature decides for itself runs for real: parsing the market, refusing the forbidden ones,
 * judging the sample, choosing two, and the unique indexes that make a rerun safe.
 */

/** An offer as the Hopegaming adapter returns it. `total=9.5` is their specifier format. */
function offer(marketName: string, outcomeName: string, line: string, odds: number) {
  return {
    raw: { marketId: "m", outcomeId: "o", specifier: `total=${line}`, marketName, outcomeName },
    market: null,
    odds,
    probability: null,
  };
}

function fixture(externalId: string, home: string, away: string, offers: ReturnType<typeof offer>[]) {
  return {
    event: {
      externalId,
      home,
      away,
      kickoffAt: new Date("2026-11-02T15:00:00Z"),
      competition: "Premier League",
      country: "England",
      status: "NOT_STARTED" as const,
    },
    offers,
  };
}

/** Eight matches, counted back from the run date, alternating home and away. */
const sample = (values: number[]): Observation[] =>
  values.map((value, i) => ({ value, kickoffAt: `2026-10-${String(i + 1).padStart(2, "0")}T15:00:00Z`, wasHome: i % 2 === 0 }));

/** A sample that clears every gate: eight matches, well clear of a 9.5 line. */
const strong = sample([14, 13, 12, 15, 11, 13, 14, 12]);
/** A sample that cannot clear a 9.5 line: averaging exactly 9.5, so the margin gate refuses it. */
const weak = sample([9, 10, 9, 10, 9, 10, 9, 10]);

type Samples = Record<string, Observation[]>;

/** Runs generation with the three outside edges stubbed. Returns the real result. */
async function generate(fixtures: ReturnType<typeof fixture>[], samples: Samples, live = ["sportybet"]) {
  vi.doMock("@/lib/bookmakers/registry", () => ({
    getAdapter: (slug: string) => ({ slug, mode: live.includes(slug) ? "live" : "mock", capabilities: { events: true } }),
  }));
  vi.doMock("@/lib/bookmakers/live/sportybet", () => ({ listUpcomingWithOffers: async () => fixtures }));
  vi.doMock("@/lib/bookmakers/live/footballcom", () => ({ listUpcomingWithOffers: async () => fixtures }));
  vi.doMock("@/lib/services/stats", () => ({
    // The stats fixture id is derived from the bookmaker id so each fixture maps to its own match.
    lookupMatch: async (home: string) => {
      if (home.startsWith("Unmatched")) return null;
      // Keyed by name so a fixture keeps its ids wherever it sits in the list.
      if (home === "Spurs") return { id: 9009, home: { id: 3 }, away: { id: 4 } };
      const index = fixtures.findIndex((f) => f.event.home === home);
      return index < 0 ? null : { id: 9000 + index, home: { id: index * 2 + 1 }, away: { id: index * 2 + 2 } };
    },
  }));
  vi.doMock("@/lib/special-picks/research", async (orig) => {
    const real = (await orig()) as typeof import("@/lib/special-picks/research");
    return {
      ...real,
      research: async (market: { kind: string }, homeId: number) => {
        const observations = samples[`${homeId}:${market.kind}`] ?? samples[String(homeId)] ?? null;
        return observations && { observations, incomplete: 0, sources: ["test"] };
      },
    };
  });

  vi.resetModules();
  const { generateSpecialPicks } = await import("@/lib/services/special-picks");
  return generateSpecialPicks(new Date("2026-11-02T07:00:00Z"));
}

beforeEach(async () => {
  await db.specialSlip.deleteMany({}); // cascades to its legs
  await db.specialPick.deleteMany({});
});
afterEach(() => {
  vi.doUnmock("@/lib/bookmakers/registry");
  vi.doUnmock("@/lib/bookmakers/live/sportybet");
  vi.doUnmock("@/lib/bookmakers/live/footballcom");
  vi.doUnmock("@/lib/services/stats");
  vi.doUnmock("@/lib/special-picks/research");
});

// Prices that reach the 2.00 target: a pair comfortably, and either one on its own, so a test
// about publishing one selection is not really a test about the target.
// Prices whose product lands on the target: 1.45 x 1.40 is 2.03, inside the 1.90-2.10 band.
const corners = (line: string, odds = 1.45) => offer("Corners - Over/Under", "Over", line, odds);
const shots = (line: string, odds = 1.4) => offer("Shots on Target Over/Under", "Over", line, odds);

// A slip needs two legs, so a test about anything else still has to supply a second fixture.
const partner = () => fixture("e9", "Spurs", "Everton", [shots("8.5")]);
const withPartner = { "1": strong, "3": strong };

describe("publishing the day's selections", () => {
  it("publishes two when two qualify, from different matches", async () => {
    const result = await generate(
      [fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), fixture("e2", "Spurs", "Everton", [shots("8.5")])],
      { "1": strong, "3": strong },
    );

    expect(result.published).toBe(2);
    const rows = await db.specialPick.findMany({ orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(new Set(rows.map((r) => r.statsFixtureId)).size).toBe(2);
    // Every row carries a verified price from the offer it came from, never a made-up one.
    expect(rows.every((r) => r.odds !== null && r.bookmaker === "sportybet")).toBe(true);
    expect(rows.map((r) => Number(r.odds)).sort()).toEqual([1.4, 1.45]);
  });

  // The bug this replaces: the slug came from the first live adapter in the registry while the
  // offers were always read from SportyBet, so a price could be published under another name.
  it("records the bookmaker the price was actually read from", async () => {
    await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), partner()], withPartner, ["footballcom"]);
    expect((await db.specialPick.findFirstOrThrow({})).bookmaker).toBe("footballcom");
  });

  it("publishes nothing when no bookmaker is connected to live prices", async () => {
    const result = await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), partner()], withPartner, []);
    expect(result.published).toBe(0);
    expect(result.skipped.join(" ")).toContain("No bookmaker is connected");
    expect(await db.specialPick.count()).toBe(0);
  });

  // A slip is an accumulator, so one qualifying selection is not a slip. The old behaviour -
  // publish the one that qualified - is what made a day's research look like a single tip.
  it("publishes nothing when only one selection qualifies", async () => {
    // The second fixture's sample sits exactly on its line, so the margin gate refuses it.
    const result = await generate(
      [fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), fixture("e2", "Spurs", "Everton", [shots("9.5")])],
      { "1": strong, "3": weak },
    );

    expect(result.published).toBe(0);
    expect(await db.specialSlip.count()).toBe(0);
    expect(await db.specialPick.count()).toBe(0);
  });

  it("publishes nothing when nothing qualifies, and says why", async () => {
    const result = await generate(
      [fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), fixture("e9", "Spurs", "Everton", [shots("9.5")])],
      { "1": weak, "3": weak },
    );

    expect(result.published).toBe(0);
    expect(result.skipped.join(" ")).toContain("threshold");
    expect(await db.specialPick.count()).toBe(0);
  });

  it("publishes nothing when no specialist market is priced", async () => {
    // A full book of exactly the markets the brief forbids.
    const forbidden = [
      offer("1X2", "Home", "", 1.8),
      offer("Over/Under", "Over", "2.5", 1.9),
      offer("Both Teams To Score", "Yes", "", 1.7),
      offer("Double Chance", "1X", "", 1.3),
    ];
    const result = await generate([fixture("e1", "Arsenal", "Chelsea", forbidden)], withPartner);

    expect(result.published).toBe(0);
    expect(result.skipped.join(" ")).toContain("No specialist market");
    expect(await db.specialPick.count()).toBe(0);
  });

  it("publishes nothing when the research has no statistics to work from", async () => {
    const result = await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), partner()], {});
    expect(result.published).toBe(0);
    expect(await db.specialPick.count()).toBe(0);
  });

  // A fixture with no match at the stats provider has nothing to research it with and nothing to
  // settle it from later, so it must not reach the table however good its price looks.
  it("skips a fixture the stats provider cannot be matched to", async () => {
    const result = await generate(
      [
        fixture("e1", "Unmatched FC", "Chelsea", [corners("9.5")]),
        fixture("e2", "Spurs", "Everton", [shots("8.5")]),
        fixture("e3", "Brighton", "Fulham", [corners("9.5")]),
      ],
      { "1": strong, "3": strong, "5": strong },
    );

    // The slip is built from the two that could be matched; the third could never be settled.
    expect(result.published).toBe(2);
    const rows = await db.specialPick.findMany({});
    expect(rows.map((r) => r.homeTeam).sort()).toEqual(["Brighton", "Spurs"]);
  });

  it("does not publish a second time when the day is already published", async () => {
    const fixtures = [fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), fixture("e2", "Spurs", "Everton", [shots("8.5")])];
    const samples = { "1": strong, "3": strong };

    await generate(fixtures, samples);
    const second = await generate(fixtures, samples);

    expect(second.published).toBe(0);
    expect(second.skipped.join(" ")).toContain("already published");
    expect(await db.specialPick.count()).toBe(2);
  });

  it("keeps the first run's selections and prices when the second run sees different odds", async () => {
    const samples = { "1": strong, "3": strong };
    await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5", 1.45)]), fixture("e2", "Spurs", "Everton", [shots("8.5")])], samples);

    // Same day, price moved. The published record must not follow it.
    await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5", 1.5)]), fixture("e2", "Spurs", "Everton", [shots("8.5")])], samples);

    const row = await db.specialPick.findFirstOrThrow({ where: { marketKind: "CORNERS" } });
    expect(Number(row.odds)).toBe(1.45);
  });

  it("records the evidence it decided on, so a published selection can be checked afterwards", async () => {
    await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), partner()], withPartner);
    const row = await db.specialPick.findFirstOrThrow({ where: { homeTeam: "Arsenal" } });
    const evidence = row.evidence as { sample: number; values: number[]; hitRate: number };

    expect(evidence.sample).toBe(8);
    expect(evidence.values).toEqual([14, 13, 12, 15, 11, 13, 14, 12]);
    expect(evidence.hitRate).toBe(1);
    expect(row.reason).toContain("Over 9.5 in 8 of 8 matches");
    // The estimate is shrunk toward even money rather than claiming eight from eight is certainty.
    expect(Number(row.probability)).toBeLessThan(1);
    expect(Number(row.probability)).toBeGreaterThan(0.6);
  });

  it("opens the day's odds history with the price it published", async () => {
    await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), partner()], withPartner);
    const row = await db.specialPick.findFirstOrThrow({ where: { homeTeam: "Arsenal" }, include: { oddsHistory: true } });

    expect(row.oddsHistory).toHaveLength(1);
    expect(Number(row.oddsHistory[0].odds)).toBe(1.45);
  });
});

describe("the day a selection belongs to", () => {
  it("files a selection under the Ghana date of the run, not the fixture's", async () => {
    // Ghana is GMT, so the boundary is UTC midnight. A 07:00 run on the 2nd publishes for the 2nd.
    await generate([fixture("e1", "Arsenal", "Chelsea", [corners("9.5")]), partner()], withPartner);
    const row = await db.specialPick.findFirstOrThrow({ where: { homeTeam: "Arsenal" } });
    expect(row.forDate.toISOString().slice(0, 10)).toBe("2026-11-02");
  });

  it("treats a run just before midnight as the day that is ending", async () => {
    const { ghanaDate } = await import("@/lib/services/daily-picks");
    expect(ghanaDate(new Date("2026-11-02T23:59:59Z"))).toBe("2026-11-02");
    expect(ghanaDate(new Date("2026-11-03T00:00:00Z"))).toBe("2026-11-03");
  });
});
