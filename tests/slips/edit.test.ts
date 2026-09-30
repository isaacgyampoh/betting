import { describe, expect, it } from "vitest";
import { applyEdit, keepSafest, removeGames, splitSlip, trimToOdds, type EditItem } from "@/lib/slips/edit";

const items: EditItem[] = [
  { position: 1, odds: 2.1 },
  { position: 2, odds: 1.3 },
  { position: 3, odds: 1.85 },
  { position: 4, odds: 3.4 },
  { position: 5, odds: 1.15 },
  { position: 6, odds: 1.6 },
];

describe("slip edits", () => {
  it("removes games", () => expect(removeGames(items, [2, 4])).toEqual([1, 3, 5, 6]));

  it("keeps the N safest, in slip order", () => {
    expect(keepSafest(items, 3)).toEqual([2, 5, 6]);
    expect(keepSafest(items, 0)).toEqual([]);
    expect(keepSafest(items, 99)).toHaveLength(6);
  });

  it("trims to target odds by dropping the riskiest picks", () => {
    // Safest-first: 1.15 × 1.3 × 1.6 × 1.85 = 4.43; × 2.1 = 9.29; × 3.4 = 31.6
    expect(trimToOdds(items, 10)).toEqual([1, 2, 3, 5, 6]);
    expect(trimToOdds(items, 5)).toEqual([2, 3, 5, 6]);
    expect(trimToOdds(items, 1.1)).toEqual([]);
    expect(trimToOdds(items, 1000)).toHaveLength(6);
  });

  it("splits into balanced slips covering every game once", () => {
    const groups = splitSlip(items, 2);
    expect(groups).toHaveLength(2);
    expect(groups.flat().sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Math.abs(groups[0].length - groups[1].length)).toBeLessThanOrEqual(1);
    const totals = applyEdit(items, { type: "split", parts: 2 }).totals as number[];
    expect(Math.max(...totals) / Math.min(...totals)).toBeLessThan(3);
  });

  it("never makes more slips than games", () => {
    expect(splitSlip(items.slice(0, 2), 5)).toHaveLength(2);
  });

  it("reports totals per result slip", () => {
    expect(applyEdit(items, { type: "safest", count: 2 })).toEqual({ groups: [[2, 5]], totals: [1.5] });
  });
});
