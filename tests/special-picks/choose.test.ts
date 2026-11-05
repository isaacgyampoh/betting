import { describe, expect, it } from "vitest";
import { choose } from "@/lib/services/special-picks";

/**
 * Which two go up.
 *
 * The brief is specific here and the rules pull against each other: publish the two strongest, but
 * never two correlated outcomes from the same match, and never manufacture a second to fill the
 * quota. So strength is not the only input - a slightly weaker candidate on another fixture beats
 * a stronger one on the same.
 */
const cand = (id: string, kind: string, rating: number, odds = 1.9, probability = 0.7) =>
  ({
    candidate: {
      event: { externalId: id, home: "H", away: "A", kickoffAt: new Date(), competition: null, country: null, status: "NOT_STARTED" },
      bookmaker: "sportybet",
      market: { kind, side: "MATCH", period: "FT" },
      rawMarketName: "x",
      line: 9.5,
      outcome: "OVER",
      odds,
    },
    statsFixtureId: 1,
    rating,
    confidence: "medium",
    probability,
    reason: "",
    evidence: {},
  }) as unknown as Parameters<typeof choose>[0][number];

describe("choosing the day's selections", () => {
  it("publishes the two strongest when they are different matches", () => {
    const got = choose([cand("m1", "CORNERS", 70), cand("m2", "SHOTS", 65), cand("m3", "CORNERS", 60)]);
    expect(got.map((c) => c.candidate.event.externalId)).toEqual(["m1", "m2"]);
  });

  // The correlation rule. Two corner lines on one game are nearly one bet.
  it("never takes two selections from the same match", () => {
    const got = choose([cand("m1", "CORNERS", 80), cand("m1", "SHOTS", 79), cand("m2", "CORNERS", 50)]);
    expect(got).toHaveLength(2);
    expect(got[1].candidate.event.externalId).toBe("m2");
  });

  it("prefers a different statistic for the second selection", () => {
    // m2 rates higher than m3 but repeats the first pick's market; m3 is taken instead.
    const got = choose([cand("m1", "CORNERS", 80), cand("m2", "CORNERS", 70), cand("m3", "SHOTS", 68)]);
    expect(got.map((c) => c.candidate.market.kind)).toEqual(["CORNERS", "SHOTS"]);
  });

  it("falls back to the same statistic rather than publishing one, when that is all there is", () => {
    const got = choose([cand("m1", "CORNERS", 80), cand("m2", "CORNERS", 70)]);
    expect(got).toHaveLength(2);
    expect(got[1].candidate.event.externalId).toBe("m2");
  });

  // Nothing is invented to reach two.
  it("publishes one when only one qualifies, and it is long enough on its own", () => {
    expect(choose([cand("m1", "CORNERS", 80, 2.4)])).toHaveLength(1);
  });

  it("publishes nothing when the only candidate is too short to reach the target alone", () => {
    expect(choose([cand("m1", "CORNERS", 80, 1.9)])).toEqual([]);
  });

  it("publishes one when every other candidate is the same match", () => {
    const got = choose([
      cand("m1", "CORNERS", 80, 2.4),
      cand("m1", "SHOTS", 75, 2.4),
      cand("m1", "SHOTS_ON_TARGET", 70, 2.4),
    ]);
    expect(got).toHaveLength(1);
  });

  it("publishes nothing when nothing qualifies", () => {
    expect(choose([])).toEqual([]);
  });
});

/**
 * Two odds, meaning what it already means elsewhere in this codebase: the slip must *reach* 2.00,
 * and among the ways of reaching it the best chance wins.
 *
 * This is the rule the first four days did not have. Each selection was ranked on its own merits,
 * so the day published 1.08 and 1.23 - both defensible alone, together worth 1.33 for a day of
 * research.
 */
describe("reaching two odds", () => {
  it("refuses a pair that does not reach the target", () => {
    // 1.3 x 1.4 = 1.82, and neither is long enough by itself.
    expect(choose([cand("m1", "CORNERS", 90, 1.3), cand("m2", "SHOTS", 85, 1.4)])).toEqual([]);
  });

  it("takes a pair that reaches it over two higher-rated selections that do not", () => {
    const got = choose([
      cand("m1", "CORNERS", 95, 1.08),
      cand("m2", "SHOTS", 94, 1.23),
      cand("m3", "CORNERS", 60, 1.45),
      cand("m4", "SHOTS", 59, 1.5),
    ]);
    expect(got.map((c) => c.candidate.event.externalId)).toEqual(["m3", "m4"]);
    expect(got[0].candidate.odds * got[1].candidate.odds).toBeGreaterThanOrEqual(2);
  });

  it("prefers the best combined chance among the pairs that reach it", () => {
    const got = choose([
      cand("m1", "CORNERS", 80, 2.0, 0.6),
      cand("m2", "SHOTS", 70, 2.0, 0.85),
      cand("m3", "SHOTS", 75, 2.0, 0.8),
    ]);
    // m2 and m3 together are 0.68; either with m1 is less, despite m1 rating highest.
    expect(got.map((c) => c.candidate.event.externalId).sort()).toEqual(["m2", "m3"]);
  });

  it("breaks a tie by landing closest to the target rather than padding it with price", () => {
    const got = choose([
      cand("m1", "CORNERS", 80, 1.45, 0.8),
      cand("m2", "SHOTS", 79, 1.45, 0.8),
      cand("m3", "SHOTS", 78, 4.0, 0.8),
    ]);
    // 1.45 x 1.45 = 2.1025, against 1.45 x 4.0 = 5.8 for the same chance.
    const total = got[0].candidate.odds * got[1].candidate.odds;
    expect(total).toBeCloseTo(2.1025, 5);
  });

  it("still never pairs two selections from the same match to reach it", () => {
    const got = choose([cand("m1", "CORNERS", 90, 1.5), cand("m1", "SHOTS", 89, 1.5), cand("m2", "CORNERS", 50, 1.4)]);
    expect(new Set(got.map((c) => c.candidate.event.externalId)).size).toBe(got.length);
  });
});
