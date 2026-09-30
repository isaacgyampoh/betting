import { describe, expect, it } from "vitest";
import { slipRisk } from "@/lib/slips/risk";

describe("slip risk", () => {
  it("short prices on a small slip read as low risk", () => {
    const r = slipRisk([
      { position: 1, odds: 1.2 },
      { position: 2, odds: 1.25 },
    ]);
    expect(r.level).toBe("low");
    expect(r.probability).toBeGreaterThan(0.4);
    expect(r.riskiest).toHaveLength(0);
    expect(r.summary).toMatch(/chance all of them land/);
  });

  it("long shots and many games read as high risk", () => {
    const r = slipRisk([
      { position: 1, odds: 3.4 },
      { position: 2, odds: 4.1 },
      { position: 3, odds: 2.8 },
      { position: 4, odds: 5.0 },
    ]);
    expect(r.level).toBe("high");
    expect(r.riskiest.length).toBeGreaterThan(0);
    // worst price first
    expect(r.riskiest[0].odds).toBe(5.0);
    expect(r.riskiest[0].reason).toMatch(/chance on its own/);
  });

  it("more games lowers the chance even at the same prices", () => {
    const two = slipRisk([{ position: 1, odds: 1.8 }, { position: 2, odds: 1.8 }]);
    const six = slipRisk(Array.from({ length: 6 }, (_, i) => ({ position: i + 1, odds: 1.8 })));
    expect(six.probability).toBeLessThan(two.probability);
  });

  it("flags a started game whatever its price", () => {
    const r = slipRisk([{ position: 1, odds: 1.1, started: true }, { position: 2, odds: 1.2 }]);
    expect(r.riskiest.some((x) => x.reason.includes("already started"))).toBe(true);
  });

  it("says so when there are no prices, instead of guessing", () => {
    const r = slipRisk([{ position: 1, odds: null }]);
    expect(r.probability).toBe(0);
    expect(r.summary).toMatch(/can't estimate/);
  });

  it("never claims certainty", () => {
    for (const odds of [1.01, 1.5, 10]) {
      const r = slipRisk([{ position: 1, odds }]);
      expect(r.summary).not.toMatch(/guarantee|certain|sure|100%/i);
    }
  });
});
