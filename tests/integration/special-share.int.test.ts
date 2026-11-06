import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { slipReference, specialSlipByReference } from "@/lib/services/special-picks";

/**
 * A shared slip has already left.
 *
 * Whoever opens the link was sent it; asking them to sign in to see what they were sent is how a
 * share link stops being shared. So the lookup is by public reference, it is readable without a
 * session, and it shows the slip as published rather than whatever is newest.
 */
const DATE = "2026-11-05";

const leg = (position: number, odds: number, home: string) => ({
  forDate: new Date(DATE),
  position,
  statsFixtureId: 7000 + position,
  homeTeam: home,
  awayTeam: "Away",
  competition: "Premier League",
  country: "England",
  kickoffAt: new Date("2026-11-05T19:45:00Z"),
  marketKind: "CORNERS",
  marketSide: "MATCH",
  marketPeriod: "FT",
  line: 9.5,
  outcome: "OVER",
  bookmaker: "sportybet",
  rawMarketName: "Corners - Over/Under",
  odds,
  oddsCheckedAt: new Date(),
  probability: 0.8,
  confidence: "medium",
  rating: 62,
  reason: `Over 9.5 in 7 of 8 matches for ${home}.`,
  evidence: { sample: 8 },
  researchedAt: new Date(),
});

async function publish() {
  return db.specialSlip.create({
    data: {
      forDate: new Date(DATE),
      reference: slipReference(DATE),
      combinedOdds: 2.03,
      target: 2,
      summary: "2 selections at 2.03, on match corners.",
      lastVerifiedAt: new Date("2026-11-05T07:00:00Z"),
      picks: { create: [leg(1, 1.45, "Arsenal"), leg(2, 1.4, "Spurs")] },
    },
  });
}

beforeEach(async () => {
  await db.specialSlip.deleteMany({});
  await db.specialPick.deleteMany({});
});

describe("a slip by its public reference", () => {
  it("is derived from the date, so a link from a screenshot still resolves", () => {
    expect(slipReference("2026-11-05")).toBe("GC261105");
    expect(slipReference("2026-11-05")).toBe(slipReference("2026-11-05"));
    expect(slipReference("2026-11-06")).not.toBe(slipReference("2026-11-05"));
  });

  it("returns the slip with every leg, in order", async () => {
    await publish();
    const slip = await specialSlipByReference("GC261105");

    expect(slip).not.toBeNull();
    expect(slip!.combinedOdds).toBe(2.03);
    expect(slip!.legs.map((l) => l.position)).toEqual([1, 2]);
    expect(slip!.legs.map((l) => l.match.home)).toEqual(["Arsenal", "Spurs"]);
    expect(slip!.summary).toContain("2.03");
    expect(slip!.target).toBe(2);
  });

  it("carries when its prices were last checked, because a morning price is not a price now", async () => {
    await publish();
    const slip = await specialSlipByReference("GC261105");
    expect(slip!.lastVerifiedAt).toBe("2026-11-05T07:00:00.000Z");
  });

  it("reports the price now alongside the price it was published at", async () => {
    await publish();
    const slip = await specialSlipByReference("GC261105");
    // Nothing has moved, so the two agree - but they are separate fields and always will be.
    expect(slip!.combinedOdds).toBe(2.03);
    expect(slip!.currentOdds).toBe(2.03);
  });

  it("is null for a reference that was never published", async () => {
    expect(await specialSlipByReference("GC999999")).toBeNull();
  });

  // The published price is the record. A leg losing its price later must not silently change it.
  it("keeps the published combined price even when a leg no longer prices", async () => {
    const slip = await publish();
    await db.specialPick.updateMany({ where: { slipId: slip.id, position: 2 }, data: { odds: null } });

    const read = await specialSlipByReference("GC261105");
    expect(read!.combinedOdds).toBe(2.03); // as published
    expect(read!.currentOdds).toBeNull(); // not computable now, rather than wrong
  });
});
