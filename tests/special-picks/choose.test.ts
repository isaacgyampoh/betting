import { describe, expect, it } from "vitest";
import { choose, combinedOdds, SPECIAL_BAND, SPECIAL_IDEAL, SPECIAL_LEGS } from "@/lib/services/special-picks";

/**
 * Which matches go on the day's slip.
 *
 * The slip is the product, so the combination is what is chosen - not the best legs, which is how
 * a day's research once went out as 1.08 and 1.23, each defensible alone and together worth 1.33.
 * The rules pull against each other: land near 2.00, never put two lines from one match on the
 * same accumulator, and never add a leg just to reach the target.
 */
const cand = (id: string, kind: string, rating: number, odds: number, probability = 0.8) =>
  ({
    candidate: {
      event: { externalId: id, home: `H${id}`, away: `A${id}`, kickoffAt: new Date(), competition: null, country: null, status: "NOT_STARTED" },
      bookmaker: "sportybet",
      market: { kind, side: "MATCH", period: "FT" },
      rawMarketName: "x",
      line: 9.5,
      outcome: "OVER",
      odds,
    },
    statsFixtureId: Number(id.replace(/\D/g, "")) || 1,
    rating,
    confidence: "medium",
    probability,
    reason: "",
    evidence: { sample: 8 },
  }) as unknown as Parameters<typeof choose>[0][number];

const total = (picks: ReturnType<typeof choose>) => picks.reduce((t, p) => t * p.candidate.odds, 1);

describe("building the day's slip", () => {
  it("combines two matches whose prices land on the target", () => {
    const got = choose([cand("m1", "CORNERS", 80, 1.45), cand("m2", "SHOTS", 75, 1.4)]);

    expect(got).toHaveLength(2);
    expect(total(got)).toBeCloseTo(2.03, 5);
  });

  it("takes three when three are what reaches the target", () => {
    // No pair gets there: 1.27 x 1.27 is 1.61. All three make 2.05.
    const got = choose([
      cand("m1", "CORNERS", 80, 1.27),
      cand("m2", "SHOTS", 79, 1.27),
      cand("m3", "SHOTS_ON_TARGET", 78, 1.27),
    ]);

    expect(got).toHaveLength(3);
    expect(total(got)).toBeGreaterThanOrEqual(SPECIAL_BAND.min);
  });

  it("never puts more than three on a slip", () => {
    const got = choose([
      cand("m1", "CORNERS", 80, 1.2),
      cand("m2", "SHOTS", 79, 1.2),
      cand("m3", "SHOTS_ON_TARGET", 78, 1.2),
      cand("m4", "CORNERS", 77, 1.2),
      cand("m5", "SHOTS", 76, 1.2),
    ]);
    expect(got.length).toBeLessThanOrEqual(SPECIAL_LEGS.max);
  });

  // Nothing is added to reach the target, and nothing short of it is published.
  it("publishes nothing when no combination reaches the target", () => {
    const got = choose([cand("m1", "CORNERS", 90, 1.2), cand("m2", "SHOTS", 89, 1.2)]);
    expect(got).toEqual([]);
  });

  it("publishes nothing when every combination overshoots the band", () => {
    const got = choose([cand("m1", "CORNERS", 90, 1.9), cand("m2", "SHOTS", 89, 1.9)]);
    expect(got).toEqual([]);
    expect(1.9 * 1.9).toBeGreaterThan(SPECIAL_BAND.max);
  });

  it("never publishes a single selection, however long its price", () => {
    expect(choose([cand("m1", "CORNERS", 95, 2.0)])).toEqual([]);
  });

  // Two lines on one match are nearly one bet, and an accumulator whose legs cannot fail
  // independently is not an accumulator.
  it("never puts two selections from the same match on the slip", () => {
    const got = choose([cand("m1", "CORNERS", 90, 1.45), cand("m1", "SHOTS", 89, 1.4), cand("m2", "CORNERS", 50, 1.4)]);

    expect(new Set(got.map((c) => c.candidate.event.externalId)).size).toBe(got.length);
  });
});

describe("choosing between the combinations that reach it", () => {
  it("prefers the one most likely to come in", () => {
    const got = choose([
      cand("m1", "CORNERS", 60, 1.45, 0.9),
      cand("m2", "SHOTS", 59, 1.4, 0.9),
      cand("m3", "CORNERS", 95, 1.45, 0.7),
      cand("m4", "SHOTS", 94, 1.4, 0.7),
    ]);

    // m3 and m4 rate highest. m1 and m2 are likelier, and the slip is a bet, not a ranking.
    expect(got.map((c) => c.candidate.event.externalId).sort()).toEqual(["m1", "m2"]);
  });

  it("prefers landing inside 1.99-2.01 over merely inside the band", () => {
    const got = choose([
      cand("m1", "CORNERS", 80, 1.42),
      cand("m2", "SHOTS", 79, 1.41),
      cand("m3", "CORNERS", 78, 1.4),
      cand("m4", "SHOTS", 77, 1.5),
    ]);

    const t = total(got);
    expect(t).toBeGreaterThanOrEqual(SPECIAL_IDEAL.min);
    expect(t).toBeLessThanOrEqual(SPECIAL_IDEAL.max);
  });

  it("keeps every published slip inside the band", () => {
    const got = choose([
      cand("m1", "CORNERS", 80, 1.33),
      cand("m2", "SHOTS", 79, 1.5),
      cand("m3", "SHOTS_ON_TARGET", 78, 1.45),
      cand("m4", "CORNERS", 77, 1.2),
    ]);

    expect(got.length).toBeGreaterThanOrEqual(SPECIAL_LEGS.min);
    expect(total(got)).toBeGreaterThanOrEqual(SPECIAL_BAND.min);
    expect(total(got)).toBeLessThanOrEqual(SPECIAL_BAND.max);
  });
});

describe("the combined price", () => {
  it("is the legs multiplied, not added", () => {
    expect(combinedOdds([1.45, 1.4])).toBe(2.03);
    expect(combinedOdds([1.27, 1.27, 1.27])).toBe(2.048);
  });

  it("is one for an empty slip, so a missing leg cannot read as a price", () => {
    expect(combinedOdds([])).toBe(1);
  });
});
