// Picks the combination of games that reaches a target total odds with the highest estimated
// probability of all of them landing. Pure and client-safe, so the UI can preview exactly what the
// server will book.
//
// Probability per pick starts from the bookmaker's own price with its margin removed (the price is
// the market's view, and the most honest number we have), then moves within a small band when the
// stats we hold agree or disagree with it. It is an estimate, never a promise.

export type Candidate = {
  position: number;
  odds: number;
  /**
   * The bookmaker's own margin-free probability, when it publishes one (SportyBet sends one for
   * every outcome). Always better than deriving it from the price with an assumed margin, so it
   * wins when present. Never fill this in with a guess.
   */
  bookmakerProbability?: number;
  /** 0..1 from stats (form, head-to-head, table). Undefined when we have no stats for the game. */
  statProbability?: number;
  /** Why the stats lean that way, in plain words. */
  statReason?: string;
};

export type ScoredPick = Candidate & {
  /** Estimated chance this single pick lands (0..1). */
  probability: number;
  /** How the estimate was reached, for the explanation shown to the user. */
  basis: "odds" | "odds+stats" | "bookmaker" | "bookmaker+stats";
};

export type TargetSelection = {
  positions: number[];
  totalOdds: number;
  /** Estimated chance every pick in the slip lands (0..1). */
  probability: number;
  picks: ScoredPick[];
  /** How close we got, when the exact target isn't reachable. */
  reachedTarget: boolean;
};

/** Typical bookmaker margin per pick; removing it turns a price into a fairer probability. */
const MARGIN = 0.06;
/** How far stats may move the price-implied probability, as a share of the gap between them. */
const STATS_WEIGHT = 0.35;

export function impliedProbability(odds: number): number {
  return odds > 1 ? Math.min(0.99, 1 / odds / (1 + MARGIN)) : 0;
}

export function scorePick(c: Candidate): ScoredPick {
  // Prefer the bookmaker's published probability; fall back to stripping an assumed margin.
  const published = c.bookmakerProbability !== undefined && c.bookmakerProbability > 0 && c.bookmakerProbability <= 1;
  const base = published ? c.bookmakerProbability! : impliedProbability(c.odds);
  if (c.statProbability === undefined) return { ...c, probability: base, basis: published ? "bookmaker" : "odds" };
  const blended = base + (c.statProbability - base) * STATS_WEIGHT;
  return {
    ...c,
    probability: Math.min(0.97, Math.max(0.03, blended)),
    basis: published ? "bookmaker+stats" : "odds+stats",
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Finds the subset whose total odds are closest to (and at least) the target, preferring the
 * highest combined probability. Exhaustive for small slips, then a greedy fallback so it stays fast.
 */
export function buildTargetSlip(candidates: Candidate[], target: number, opts: { maxPicks?: number } = {}): TargetSelection | null {
  const picks = candidates.filter((c) => c.odds > 1).map(scorePick);
  if (!picks.length || target < 1) return null;
  const maxPicks = Math.min(opts.maxPicks ?? 8, picks.length);

  let best: { positions: number[]; total: number; probability: number } | null = null;
  const consider = (chosen: ScoredPick[]) => {
    if (!chosen.length) return;
    const total = chosen.reduce((p, c) => p * c.odds, 1);
    const probability = chosen.reduce((p, c) => p * c.probability, 1);
    if (total < target - 1e-9) return; // must at least reach the target
    if (
      !best ||
      // prefer the higher chance; break ties by getting closer to the target, then fewer games
      probability > best.probability + 1e-9 ||
      (Math.abs(probability - best.probability) <= 1e-9 && total < best.total - 1e-9)
    ) {
      best = { positions: chosen.map((c) => c.position).sort((a, b) => a - b), total, probability };
    }
  };

  if (picks.length <= 18) {
    // Exhaustive over subsets (bit mask), capped at maxPicks games.
    for (let mask = 1; mask < 1 << picks.length; mask++) {
      const chosen: ScoredPick[] = [];
      for (let i = 0; i < picks.length; i++) if (mask & (1 << i)) chosen.push(picks[i]);
      if (chosen.length <= maxPicks) consider(chosen);
    }
  } else {
    // Greedy: add the highest-probability picks until the target is reached, then try swaps.
    const byProb = [...picks].sort((a, b) => b.probability - a.probability);
    const chosen: ScoredPick[] = [];
    let total = 1;
    for (const p of byProb) {
      if (total >= target || chosen.length >= maxPicks) break;
      chosen.push(p);
      total *= p.odds;
    }
    consider(chosen);
  }

  if (!best) {
    // Target out of reach: give the strongest slip we can (everything), and say so.
    const all = picks.slice(0, maxPicks);
    const total = all.reduce((p, c) => p * c.odds, 1);
    return {
      positions: all.map((c) => c.position).sort((a, b) => a - b),
      totalOdds: round2(total),
      probability: all.reduce((p, c) => p * c.probability, 1),
      picks: all,
      reachedTarget: false,
    };
  }

  const chosen = best as { positions: number[]; total: number; probability: number };
  const byPosition = new Map(picks.map((p) => [p.position, p]));
  return {
    positions: chosen.positions,
    totalOdds: round2(chosen.total),
    probability: chosen.probability,
    picks: chosen.positions.map((p) => byPosition.get(p)!),
    reachedTarget: true,
  };
}

export type Confidence = "low" | "medium" | "high";

/** Plain-language confidence band. Never certainty: the highest band is still "high", not "sure". */
export function confidenceOf(probability: number): Confidence {
  if (probability >= 0.55) return "high";
  if (probability >= 0.3) return "medium";
  return "low";
}

/** e.g. "roughly a 1 in 3 chance" — easier to read than a percentage, and clearly an estimate. */
export function chanceInWords(probability: number): string {
  if (probability <= 0) return "very unlikely";
  const oneIn = Math.round(1 / probability);
  if (oneIn <= 1) return "very likely";
  return `roughly a 1 in ${oneIn} chance`;
}
