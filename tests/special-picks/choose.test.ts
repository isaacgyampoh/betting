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
const cand = (id: string, kind: string, rating: number) =>
  ({
    candidate: {
      event: { externalId: id, home: "H", away: "A", kickoffAt: new Date(), competition: null, country: null, status: "NOT_STARTED" },
      bookmaker: "sportybet",
      market: { kind, side: "MATCH", period: "FT" },
      rawMarketName: "x",
      line: 9.5,
      outcome: "OVER",
      odds: 1.9,
    },
    statsFixtureId: 1,
    rating,
    confidence: "medium",
    probability: 0.7,
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
  it("publishes one when only one qualifies", () => {
    expect(choose([cand("m1", "CORNERS", 80)])).toHaveLength(1);
  });

  it("publishes one when every other candidate is the same match", () => {
    const got = choose([cand("m1", "CORNERS", 80), cand("m1", "SHOTS", 75), cand("m1", "SHOTS_ON_TARGET", 70)]);
    expect(got).toHaveLength(1);
  });

  it("publishes nothing when nothing qualifies", () => {
    expect(choose([])).toEqual([]);
  });
});
