import { describe, expect, it } from "vitest";
import { buildTargetSlip, chanceInWords, confidenceOf, impliedProbability, scorePick, type Candidate } from "@/lib/slips/target-odds";

const slip: Candidate[] = [
  { position: 1, odds: 2.1 },
  { position: 2, odds: 1.3 },
  { position: 3, odds: 1.85 },
  { position: 4, odds: 3.4 },
  { position: 5, odds: 1.15 },
  { position: 6, odds: 1.6 },
];

const totalOf = (positions: number[]) =>
  positions.reduce((p, n) => p * slip.find((c) => c.position === n)!.odds, 1);

describe("probability from odds", () => {
  it("removes the bookmaker margin (implied chance is below the raw 1/odds)", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.4717, 3);
    expect(impliedProbability(1.5)).toBeGreaterThan(impliedProbability(2));
    expect(impliedProbability(1)).toBe(0);
  });

  it("stats move the estimate but never replace the price", () => {
    const base = scorePick({ position: 1, odds: 2.0 });
    const better = scorePick({ position: 1, odds: 2.0, statProbability: 0.9 });
    const worse = scorePick({ position: 1, odds: 2.0, statProbability: 0.1 });
    expect(better.probability).toBeGreaterThan(base.probability);
    expect(worse.probability).toBeLessThan(base.probability);
    // the shift is bounded: stats can't turn a 2.0 shot into a near-certainty
    expect(better.probability).toBeLessThan(0.7);
    expect(base.basis).toBe("odds");
    expect(better.basis).toBe("odds+stats");
  });
});

describe("building a slip to a target", () => {
  it("reaches the target with the highest-probability combination", () => {
    const r = buildTargetSlip(slip, 2)!;
    expect(r.reachedTarget).toBe(true);
    expect(r.totalOdds).toBeGreaterThanOrEqual(2);
    // no cheaper-to-hit combination also reaches 2.0
    const alternatives = [[2, 6], [5, 3], [1], [2, 5, 6]].filter((p) => totalOf(p) >= 2);
    for (const alt of alternatives) {
      const altProb = alt.reduce((p, n) => p * impliedProbability(slip.find((c) => c.position === n)!.odds), 1);
      expect(r.probability).toBeGreaterThanOrEqual(altProb - 1e-9);
    }
  });

  it("higher targets mean lower estimated probability", () => {
    const two = buildTargetSlip(slip, 2)!;
    const ten = buildTargetSlip(slip, 10)!;
    expect(ten.totalOdds).toBeGreaterThanOrEqual(10);
    expect(ten.probability).toBeLessThan(two.probability);
    expect(ten.positions.length).toBeGreaterThanOrEqual(two.positions.length);
  });

  it("says so when the target is out of reach", () => {
    const r = buildTargetSlip(slip, 500)!;
    expect(r.reachedTarget).toBe(false);
    expect(r.positions).toHaveLength(6);
  });

  it("respects a maximum number of games", () => {
    const r = buildTargetSlip(slip, 5, { maxPicks: 2 })!;
    expect(r.positions.length).toBeLessThanOrEqual(2);
    expect(r.totalOdds).toBeGreaterThanOrEqual(5);
  });

  it("prefers stat-backed picks when prices are equal", () => {
    const pair: Candidate[] = [
      { position: 1, odds: 2.0, statProbability: 0.2, statReason: "poor form" },
      { position: 2, odds: 2.0, statProbability: 0.8, statReason: "strong at home" },
    ];
    expect(buildTargetSlip(pair, 1.9)!.positions).toEqual([2]);
  });

  it("stays fast on a big slip", () => {
    const big: Candidate[] = Array.from({ length: 30 }, (_, i) => ({ position: i + 1, odds: 1.2 + (i % 7) * 0.3 }));
    const started = Date.now();
    const r = buildTargetSlip(big, 8)!;
    expect(Date.now() - started).toBeLessThan(500);
    expect(r.totalOdds).toBeGreaterThanOrEqual(8);
  });

  it("returns null when there is nothing to pick from", () => {
    expect(buildTargetSlip([], 2)).toBeNull();
    expect(buildTargetSlip([{ position: 1, odds: 1 }], 2)).toBeNull();
  });
});

// Variety used to come from only ever shortlisting two picks per market. It is checked here now,
// on the slip itself, so the pool can be wider than a slip without the slip becoming five versions
// of the same bet.
describe("market variety", () => {
  const pool = (n: number, group: string, odds = 1.5) =>
    Array.from({ length: n }, (_, i) => ({ position: i, odds, bookmakerProbability: 0.65, group }));

  it("never exceeds the cap for a market, even when that market is the whole pool", () => {
    const slip = buildTargetSlip(pool(8, "goals"), 5, { maxPicks: 6, maxPerGroup: { goals: 2 } });
    expect(slip).not.toBeNull();
    expect(slip!.picks).toHaveLength(2);
    expect(slip!.reachedTarget).toBe(false); // two at 1.5 cannot reach 5, and it says so
  });

  it("spreads across markets to reach a target one market could not", () => {
    const candidates = [
      ...pool(3, "goals").map((c, i) => ({ ...c, position: i })),
      ...pool(3, "btts").map((c, i) => ({ ...c, position: 10 + i })),
      ...pool(3, "result").map((c, i) => ({ ...c, position: 20 + i })),
    ];
    const slip = buildTargetSlip(candidates, 5, { maxPicks: 6, maxPerGroup: { goals: 2, btts: 2, result: 2 } });
    expect(slip!.reachedTarget).toBe(true);
    const groups = slip!.picks.map((p) => p.group);
    for (const g of ["goals", "btts", "result"]) expect(groups.filter((x) => x === g).length).toBeLessThanOrEqual(2);
    expect(new Set(groups).size).toBeGreaterThan(1);
  });

  it("keeps the caps on the fallback when the target is out of reach", () => {
    const slip = buildTargetSlip(pool(6, "corners", 1.1), 50, { maxPicks: 6, maxPerGroup: { corners: 2 } });
    expect(slip!.reachedTarget).toBe(false);
    expect(slip!.picks).toHaveLength(2);
  });

  it("leaves a slip alone when no caps are given", () => {
    const slip = buildTargetSlip(pool(6, "goals"), 5, { maxPicks: 6 });
    expect(slip!.picks.length).toBeGreaterThan(2);
  });

  it("ignores a group with no cap of its own", () => {
    const candidates = [...pool(4, "goals"), ...pool(4, "shots").map((c, i) => ({ ...c, position: 10 + i }))];
    const slip = buildTargetSlip(candidates, 5, { maxPicks: 6, maxPerGroup: { goals: 2 } });
    expect(slip!.picks.filter((p) => p.group === "goals").length).toBeLessThanOrEqual(2);
    expect(slip!.reachedTarget).toBe(true);
  });
});

describe("how it is described", () => {
  it("bands and wording never claim certainty", () => {
    expect(confidenceOf(0.6)).toBe("high");
    expect(confidenceOf(0.4)).toBe("medium");
    expect(confidenceOf(0.1)).toBe("low");
    expect(chanceInWords(0.33)).toBe("roughly a 1 in 3 chance");
    for (const p of [0.01, 0.5, 0.99]) expect(chanceInWords(p)).not.toMatch(/sure|guarantee|certain|100%/i);
  });
});
