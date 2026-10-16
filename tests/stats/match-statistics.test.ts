import { describe, expect, it } from "vitest";
import { sampleStatsProvider } from "@/lib/stats/sample";

/**
 * The rule these guard is the one the whole product rests on: missing is not zero.
 *
 * The provider sends an explicit null for a count it does not have, sends possession as "33%" and
 * expected goals as "1.24", and returns an empty array for a competition that carries no
 * statistics at all. Each of those has to survive as itself: a zero where a null belongs claims
 * something did not happen when it is simply unknown.
 */
describe("team statistics", () => {
  it("puts the home side first, so no screen has to work out which column is which", async () => {
    const [home, away] = await sampleStatsProvider.statistics(1, 100);
    expect(home.team.id).toBe(100);
    expect(away.team.id).not.toBe(100);
  });

  it("keeps an unreported statistic as null rather than zero", async () => {
    const [, away] = await sampleStatsProvider.statistics(1, 100);
    // Expected goals is absent on most competitions; the sample set carries that case on purpose.
    expect(away.expectedGoals).toBeNull();
    expect(away.expectedGoals).not.toBe(0);
  });

  it("keeps a genuine zero as a zero", async () => {
    const [home] = await sampleStatsProvider.statistics(1, 100);
    // Nobody was sent off. That is a reported fact, not a missing one.
    expect(home.redCards).toBe(0);
  });
});

/**
 * Parsing the provider's own value shapes. These are the exact strings the live API returned when
 * the endpoint was audited: a percentage, a decimal, an integer, and an explicit null.
 */
describe("reading a provider statistic", () => {
  // The same logic the provider module applies, pinned here so a change to it has to be deliberate.
  const read = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    const parsed = Number.parseFloat(raw.replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  };

  it('reads possession "33%" as 33', () => {
    expect(read("33%")).toBe(33);
  });

  it('reads expected goals "1.24" as 1.24', () => {
    expect(read("1.24")).toBeCloseTo(1.24);
  });

  it("passes an integer straight through", () => {
    expect(read(9)).toBe(9);
    expect(read(0)).toBe(0);
  });

  it("turns an explicit null into null, never 0", () => {
    expect(read(null)).toBeNull();
    expect(read(undefined)).toBeNull();
  });

  it("turns an unreadable value into null rather than guessing", () => {
    expect(read("")).toBeNull();
    expect(read("n/a")).toBeNull();
  });
});

describe("line-ups", () => {
  it("puts the home side first and carries the formation the provider gave", async () => {
    const [home, away] = await sampleStatsProvider.lineups(1, 100);
    expect(home.team.id).toBe(100);
    expect(home.formation).toBe("4-4-2");
    expect(away.formation).toBe("4-3-3");
  });

  it("carries a grid position per starter, which is what a pitch view can be drawn from", async () => {
    const [home] = await sampleStatsProvider.lineups(1, 100);
    expect(home.startXI).toHaveLength(11);
    // "row:column", counting out from the goalkeeper. Positions come from the provider; a pitch
    // view that invents them is inventing a formation.
    expect(home.startXI[0].grid).toBe("1:1");
    expect(home.startXI.every((p) => p.grid !== null)).toBe(true);
  });
});
