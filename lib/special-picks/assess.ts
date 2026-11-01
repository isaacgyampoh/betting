/**
 * Turning a team's recent counts into a judgement about a bookmaker's line.
 *
 * Kept pure and separate from anything that fetches, because this is the part that decides what
 * gets published and it has to be examinable without a network. Everything here takes numbers and
 * returns numbers.
 *
 * The method is deliberately plain: how often did this actually happen recently, over how many
 * matches, and how settled is the number. No model is fitted. A Poisson fit would give a
 * smoother probability and a false sense of precision - it assumes a shape the data may not have,
 * and on eight observations the assumption would be doing most of the work. An empirical rate is
 * weaker, and it is honest about being weak, which is what the confidence gate is for.
 *
 * It also means the published reason is a fact rather than a paraphrase of a model: "over 9.5 in
 * 8 of their last 10" is checkable by the reader.
 */

/** A single past match's contribution to the sample. */
export type Observation = {
  /** The count that would have settled this market in that match. */
  value: number;
  /** Kick-off, so recency can be weighted and the sample can be shown. */
  kickoffAt: string;
  /** Whether the team was at home, so a home/away split can be reported. */
  wasHome: boolean;
};

export type Assessment = {
  /** Observations used. The gate below rejects small samples outright. */
  sample: number;
  /** Proportion of the sample that would have won the selection, 0..1. */
  hitRate: number;
  mean: number;
  /** Population standard deviation of the sample. */
  spread: number;
  /**
   * Our estimated chance, 0..1. **Not a price**, and never to be shown as one.
   *
   * The hit rate, pulled towards 0.5 in proportion to how little evidence there is. Eight of ten
   * is 0.8 of a thin sample, and reporting 0.8 would claim a confidence ten matches cannot
   * support; the shrinkage says so arithmetically instead of in a footnote.
   */
  probability: number;
  /** How close to the line the sample sits. A line inside the noise is a coin toss. */
  margin: number;
};

/** Below this, there is not enough history to say anything. */
export const MIN_SAMPLE = 6;

/**
 * How hard the hit rate is pulled towards even money.
 *
 * With k = 4, a perfect 10 from 10 reports 0.857 rather than 1.0, and 6 from 6 reports 0.80 -
 * figures checked against the formula rather than estimated, because a comment that quotes the
 * wrong number is worse than one that quotes none. That is the intended shape: a short unbeaten
 * run is strong evidence, not certainty, and nothing this feature publishes should read as
 * certain.
 */
const SHRINKAGE = 4;

export function assess(values: readonly Observation[], line: number, outcome: "OVER" | "UNDER"): Assessment | null {
  if (values.length < MIN_SAMPLE) return null;

  const xs = values.map((v) => v.value);
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

  // A line is always a half number at these bookmakers (9.5, 4.5), so there are no pushes to
  // handle here. A whole-number line would need one, and is rejected upstream.
  const hits = xs.filter((x) => (outcome === "OVER" ? x > line : x < line)).length;
  const hitRate = hits / n;

  const probability = (hits + SHRINKAGE * 0.5) / (n + SHRINKAGE);
  const margin = outcome === "OVER" ? mean - line : line - mean;

  return { sample: n, hitRate, mean, spread, probability, margin };
}

/**
 * Whether a bookmaker's price is worth taking, given our own estimate.
 *
 * Value is kept as its own number and never conflated with either input: `probability` is what we
 * think, `odds` is what the bookmaker offers, and this is the gap between them. Confusing any two
 * of the three is the classic way a tipping feature starts quoting its own opinion as a market
 * price.
 *
 * Returns null when there is no verified price. That is not a failure - it means the selection
 * can only be published as a statistical call, if it is published at all.
 */
export function edge(probability: number, odds: number | null): number | null {
  if (odds === null || !Number.isFinite(odds) || odds <= 1) return null;
  // Expected return per unit staked: p * odds - 1. Positive means the price is longer than our
  // estimate of the chance.
  return probability * odds - 1;
}

export type Quality = {
  /** The ranking score. Higher is better; comparable only within one day's candidates. */
  rating: number;
  confidence: "low" | "medium" | "high";
};

/**
 * How good a candidate is, as one number plus a word.
 *
 * Four things matter and they are weighted rather than multiplied, so one strong signal cannot
 * carry a candidate that is weak everywhere else:
 *
 *   * how often it has happened (the evidence itself)
 *   * how much evidence there is (ten matches beats six)
 *   * how far the line sits from the average, relative to the spread - a line one goal-kick from
 *     the mean is a coin toss however consistent the team
 *   * whether a real price exists, and whether it is generous
 *
 * Deliberately not included: the team's league position, recent results, or anything about
 * winning. A corners selection is about corners.
 */
export function quality(a: Assessment, oddsEdge: number | null): Quality {
  // Normalised distance from the line, capped: beyond about two standard deviations the extra
  // distance stops being informative and starts being a sign the line is odd.
  const z = a.spread > 0 ? Math.min(Math.abs(a.margin) / a.spread, 2) / 2 : a.margin > 0 ? 0.5 : 0;
  const depth = Math.min(a.sample / 10, 1);
  const priced = oddsEdge === null ? 0 : Math.max(-0.5, Math.min(oddsEdge, 0.5));

  const rating =
    a.probability * 50 + // what we think will happen
    z * 25 + //            how clear of the line it is
    depth * 15 + //        how much history supports it
    priced * 20; //        whether the price rewards it (and penalises a bad one)

  const confidence = rating >= 65 && a.sample >= 8 ? "high" : rating >= 55 ? "medium" : "low";
  return { rating: Math.round(rating * 1000) / 1000, confidence };
}

/**
 * The bar a selection must clear to be published at all.
 *
 * Configurable because it will need tuning once there is a record to tune against, and because
 * the right answer on a quiet Tuesday is not the right answer on a full Saturday. Publishing
 * nothing is an acceptable outcome and the default is set expecting that to happen often.
 */
export const DEFAULT_THRESHOLD = {
  minRating: 58,
  minSample: MIN_SAMPLE,
  minProbability: 0.6,
  /** A line closer than this to the average is inside the noise, whatever the hit rate says. */
  minMargin: 0.75,
} as const;

export type Threshold = typeof DEFAULT_THRESHOLD;

export function qualifies(a: Assessment, q: Quality, t: Threshold = DEFAULT_THRESHOLD): boolean {
  return a.sample >= t.minSample && a.probability >= t.minProbability && a.margin >= t.minMargin && q.rating >= t.minRating;
}
