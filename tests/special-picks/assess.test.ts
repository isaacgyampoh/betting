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
    expect(qualifies(good, quality(good, 0.15))).toBe(true);
  });

  // A line inside the noise is a coin toss however good the hit rate looks.
  it("rejects a line sitting on the average", () => {
    const onTheLine = assess(obs([10, 10, 10, 10, 10, 10, 10, 10]), 9.5, "OVER")!;
    expect(onTheLine.hitRate).toBe(1);
    expect(onTheLine.margin).toBeLessThan(DEFAULT_THRESHOLD.minMargin);
    expect(qualifies(onTheLine, quality(onTheLine, null))).toBe(false);
  });

  it("rejects a weak probability however pretty the price", () => {
    const coinToss = assess(obs([10, 9, 11, 8, 12, 9, 11, 10]), 9.5, "OVER")!;
    expect(qualifies(coinToss, quality(coinToss, 0.5))).toBe(false);
  });

  it("is configurable, because a quiet Tuesday is not a full Saturday", () => {
    const strict = { ...DEFAULT_THRESHOLD, minRating: 99 };
    expect(qualifies(good, quality(good, 0.15), strict)).toBe(false);
  });
});
