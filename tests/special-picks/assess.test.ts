import { describe, expect, it } from "vitest";
import { assess, DEFAULT_THRESHOLD, edge, MIN_SAMPLE, qualifies, quality, type Observation } from "@/lib/special-picks/assess";

/** A sample of counts, newest first; the dates only matter for display. */
const obs = (values: number[], wasHome = true): Observation[] =>
  values.map((value, i) => ({ value, kickoffAt: new Date(Date.now() - i * 86_400_000).toISOString(), wasHome }));

describe("there must be enough history to say anything", () => {
  it("refuses a sample below the minimum", () => {
    expect(assess(obs([11, 10, 12, 9, 13]), 9.5, "OVER")).toBeNull();
    expect(MIN_SAMPLE).toBe(6);
  });

  it("accepts exactly the minimum", () => {
    expect(assess(obs([11, 10, 12, 9, 13, 10]), 9.5, "OVER")).not.toBeNull();
  });
});

describe("what the sample says", () => {
  const sample = obs([12, 11, 8, 13, 10, 9, 14, 11, 7, 12]); // mean 10.7

  it("counts how often the selection would have won", () => {
    const a = assess(sample, 9.5, "OVER")!;
    // 12,11,13,10,14,11,12 are over 9.5 -> 7 of 10
    expect(a.sample).toBe(10);
    expect(a.hitRate).toBeCloseTo(0.7, 5);
    expect(a.mean).toBeCloseTo(10.7, 5);
  });

  it("counts the other way for an under", () => {
    const a = assess(sample, 9.5, "UNDER")!;
    expect(a.hitRate).toBeCloseTo(0.3, 5);
  });

  it("reports how far the average sits from the line", () => {
    expect(assess(sample, 9.5, "OVER")!.margin).toBeCloseTo(1.2, 5);
    // An under's margin is the distance the other way, so a line below the mean is negative.
    expect(assess(sample, 9.5, "UNDER")!.margin).toBeCloseTo(-1.2, 5);
  });
});

describe("nothing is ever certain", () => {
  // The whole point of the shrinkage. A short unbeaten run is interesting, not certain, and the
  // brief forbids presenting anything as guaranteed - this makes that arithmetic rather than a
  // wording rule somebody can forget.
  it("never reports a probability of 1, even from a perfect record", () => {
    const perfect = assess(obs([14, 13, 15, 12, 16, 13, 14, 15, 13, 14]), 9.5, "OVER")!;
    expect(perfect.hitRate).toBe(1);
    // 12/14: ten hits plus the two half-observations the shrinkage adds, over fourteen.
    expect(perfect.probability).toBeLessThan(0.9);
    expect(perfect.probability).toBeCloseTo(0.857, 3);
  });

  it("never reports zero either", () => {
    const none = assess(obs([2, 3, 1, 4, 2, 3]), 9.5, "OVER")!;
    expect(none.hitRate).toBe(0);
    expect(none.probability).toBeGreaterThan(0);
  });

  // Ten matches of evidence should count for more than six of the same rate.
  it("trusts a longer sample more than a short one at the same rate", () => {
    const short = assess(obs([12, 12, 12, 12, 12, 2]), 9.5, "OVER")!;
    const long = assess(obs([12, 12, 12, 12, 12, 2, 12, 12, 12, 2]), 9.5, "OVER")!;
    expect(short.hitRate).toBeCloseTo(0.833, 2);
    expect(long.hitRate).toBeCloseTo(0.8, 2);
    // Slightly lower rate, more evidence, and the estimate still lands higher.
    expect(long.probability).toBeGreaterThan(short.probability);
  });
});

describe("value is its own number", () => {
  it("is the gap between our estimate and the price", () => {
    // 60% at 2.00 is a 20% expected return per unit.
    expect(edge(0.6, 2.0)).toBeCloseTo(0.2, 5);
    // 60% at 1.50 loses money.
    expect(edge(0.6, 1.5)).toBeCloseTo(-0.1, 5);
  });

  // Not a failure. It means the selection can only be a statistical call, if published at all.
  it("is null when no price was verified", () => {
    expect(edge(0.7, null)).toBeNull();
  });

  it("refuses a nonsensical price rather than computing from it", () => {
    expect(edge(0.7, 1)).toBeNull();
    expect(edge(0.7, 0)).toBeNull();
    expect(edge(0.7, Number.NaN)).toBeNull();
  });
});

describe("ranking", () => {
  const strong = assess(obs([13, 12, 14, 11, 13, 12, 14, 13, 12, 13]), 9.5, "OVER")!;
  const marginal = assess(obs([10, 9, 11, 10, 9, 10, 11, 10, 9, 10]), 9.5, "OVER")!;

  it("rates a clear-of-the-line candidate above one sitting on it", () => {
    expect(quality(strong, null).rating).toBeGreaterThan(quality(marginal, null).rating);
  });

  it("rewards a generous price and penalises a short one", () => {
    const withValue = quality(strong, 0.3).rating;
    const flat = quality(strong, null).rating;
    const poor = quality(strong, -0.3).rating;
    expect(withValue).toBeGreaterThan(flat);
    expect(poor).toBeLessThan(flat);
  });

  it("will not call a thin sample high confidence", () => {
    const thin = assess(obs([13, 12, 14, 11, 13, 12]), 9.5, "OVER")!;
    expect(quality(thin, 0.4).confidence).not.toBe("high");
  });
});

describe("the bar for publishing", () => {
  const good = assess(obs([13, 12, 14, 11, 13, 12, 14, 13, 12, 13]), 9.5, "OVER")!;

  it("passes a candidate that is clear on every count", () => {
    expect(qualifies(good, quality(good, 0.15), 0.15)).toBe(true);
  });

  // A line inside the noise is a coin toss however good the hit rate looks.
  it("rejects a line sitting on the average", () => {
    const onTheLine = assess(obs([10, 10, 10, 10, 10, 10, 10, 10]), 9.5, "OVER")!;
    expect(onTheLine.hitRate).toBe(1);
    expect(onTheLine.margin).toBeLessThan(DEFAULT_THRESHOLD.minMargin);
    expect(qualifies(onTheLine, quality(onTheLine, 0.2), 0.2)).toBe(false);
  });

  it("rejects a weak probability however pretty the price", () => {
    const coinToss = assess(obs([10, 9, 11, 8, 12, 9, 11, 10]), 9.5, "OVER")!;
    expect(qualifies(coinToss, quality(coinToss, 0.5), 0.5)).toBe(false);
  });

  it("is configurable, because a quiet Tuesday is not a full Saturday", () => {
    const strict = { ...DEFAULT_THRESHOLD, minRating: 99 };
    expect(qualifies(good, quality(good, 0.15), 0.15, strict)).toBe(false);
  });
});

/**
 * The gate the feature shipped without, and the one that matters most.
 *
 * Its first four published selections included three with negative expected value - "over 4.5
 * corners" at 1.04 against an estimate of 0.84, which is a 12% loss per unit staked every time it
 * is taken, and which won. Winning is not the test. A well-evidenced finding the bookmaker has
 * already priced is not a bet worth publishing, and the evidence being strong is exactly why it
 * passed everything else.
 */
describe("a price that does not reward the finding", () => {
  // Sixteen of sixteen under the line, which is as strong as the evidence gets.
  const overwhelming = assess(obs(Array(16).fill(8)), 13.5, "UNDER")!;

  it("refuses a selection our own estimate says is a losing bet", () => {
    expect(overwhelming.probability).toBeCloseTo(0.9, 5);
    const value = edge(overwhelming.probability, 1.08); // 0.9 x 1.08 - 1
    expect(value).toBeLessThan(0);
    // Everything else about it is excellent, and it is still not published.
    expect(quality(overwhelming, value).rating).toBeGreaterThan(DEFAULT_THRESHOLD.minRating);
    expect(qualifies(overwhelming, quality(overwhelming, value), value)).toBe(false);
  });

  it("refuses an edge too thin to be distinguishable from estimation error", () => {
    const value = edge(overwhelming.probability, 1.14); // +2.6%
    expect(value).toBeGreaterThan(0);
    expect(value!).toBeLessThan(DEFAULT_THRESHOLD.minEdge);
    expect(qualifies(overwhelming, quality(overwhelming, value), value)).toBe(false);
  });

  it("publishes the same finding once the price is worth taking", () => {
    const value = edge(overwhelming.probability, 1.25); // +12.5%
    expect(qualifies(overwhelming, quality(overwhelming, value), value)).toBe(true);
  });

  // Very short prices need no rule of their own. Shrinkage caps the estimate at (n+2)/(n+4), so
  // sixteen matches - the most this feature ever reads - cannot exceed 0.90, and at 0.90 no price
  // under about 1.17 clears five per cent. The unbackable end of the book is therefore unreachable
  // by construction rather than by a rule somebody has to remember to keep in step.
  it("disposes of unbackable prices without a separate rule", () => {
    const best = assess(obs(Array(16).fill(8)), 13.5, "UNDER")!;
    expect(best.probability).toBeCloseTo(0.9, 5);

    for (const odds of [1.01, 1.04, 1.08, 1.14]) {
      expect(edge(best.probability, odds)!).toBeLessThan(DEFAULT_THRESHOLD.minEdge);
    }
    expect(edge(best.probability, 1.18)!).toBeGreaterThan(DEFAULT_THRESHOLD.minEdge);
  });

  // "We could not tell whether this is good value" is not a reason to publish something.
  it("refuses a selection with no usable price at all", () => {
    expect(qualifies(overwhelming, quality(overwhelming, null), null)).toBe(false);
    expect(qualifies(overwhelming, quality(overwhelming, null), edge(0.9, 1))).toBe(false);
  });
});

/**
 * The price that was actually published, and why it should not have been.
 *
 * Friday 6 November's slip led with Sevilla v Alaves, over 4.5 shots on target at 1.06, carrying
 * our own estimate of 90%. Those two numbers together are a losing bet: 0.90 x 1.06 is 0.954, so
 * the selection returns about 95p for every pound risked even if the estimate is exactly right.
 * A 90% chance reads like a strong finding and 1.06 reads like a safe price; the product of them
 * is the only thing that matters and it is negative.
 *
 * It published because the run that produced it predated the edge gate reaching production - the
 * gate was committed on 5 November, the slip model only at 10:42 on the 6th, after that morning's
 * 07:00 run. This pins the behaviour so the question cannot come back: whatever else a selection
 * has going for it, a price that does not reward the finding is refused.
 */
describe("the price has to reward the finding", () => {
  // Sixteen of sixteen clear of a 4.5 line, which is what the published evidence described.
  const observations: Observation[] = Array.from({ length: 16 }, (_, i) => ({
    value: [11, 9, 12, 10, 8, 13, 10, 11, 9, 12, 10, 11, 8, 12, 9, 11][i],
    kickoffAt: `2026-10-${String(i + 1).padStart(2, "0")}T15:00:00Z`,
    wasHome: i % 2 === 0,
  }));

  it("computes a negative edge for the published Alaves price", () => {
    expect(edge(0.9, 1.06)).toBeCloseTo(-0.046, 3);
    expect(edge(0.9, 1.06)!).toBeLessThan(0);
  });

  it("refuses it however strong the underlying evidence is", () => {
    const a = assess(observations, 4.5, "OVER")!;
    expect(a).not.toBeNull();
    // The finding itself is about as strong as this feature ever sees.
    expect(a.probability).toBeGreaterThan(0.85);
    expect(a.sample).toBe(16);

    const value = edge(a.probability, 1.06);
    expect(value!).toBeLessThan(DEFAULT_THRESHOLD.minEdge);
    expect(qualifies(a, quality(a, value), value)).toBe(false);
  });

  it("accepts the same finding once the price is long enough to pay for it", () => {
    const a = assess(observations, 4.5, "OVER")!;
    // 1.25 against a ~0.9 estimate is a positive edge, and nothing else about the pick changed.
    const value = edge(a.probability, 1.25);
    expect(value!).toBeGreaterThan(DEFAULT_THRESHOLD.minEdge);
    expect(qualifies(a, quality(a, value), value)).toBe(true);
  });

  it("refuses a missing price rather than treating it as free", () => {
    const a = assess(observations, 4.5, "OVER")!;
    expect(qualifies(a, quality(a, null), null)).toBe(false);
  });
});

