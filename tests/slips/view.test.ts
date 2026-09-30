import { describe, expect, it } from "vitest";
import { buildWarnings, toSelectionView, totalOdds, type SelectionInput } from "@/lib/slips/view";
import { marketLabel, pickLabel } from "@/lib/markets/labels";

const base: SelectionInput = {
  position: 1,
  eventExternalId: "1",
  home: "Arsenal",
  away: "Newcastle",
  competition: "Premier League",
  kickoffAt: new Date("2026-10-01T19:00:00Z"),
  market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null },
  rawMarketName: "1X2",
  rawOutcomeName: "Home",
  odds: 1.5,
};

describe("totalOdds", () => {
  it("multiplies and rounds to 2 dp", () => expect(totalOdds([1.5, 2, 1.33])).toBe(3.99));
  it("skips missing odds", () => expect(totalOdds([2, null, 3])).toBe(6));
  it("is null with no odds", () => expect(totalOdds([null])).toBeNull());
});

describe("selection view + warnings", () => {
  const now = new Date("2026-10-01T19:10:00Z");

  it("marks started games and labels picks", () => {
    const v = toSelectionView(base, now);
    expect(v.started).toBe(true);
    expect(v.pickLabel).toBe("Arsenal");
    expect(v.marketLabel).toBe("1X2");
  });

  it("falls back to raw labels for unmapped markets", () => {
    const v = toSelectionView({ ...base, market: null, rawMarketName: "Total Corners", rawOutcomeName: "Over 9.5" }, now);
    expect(v.marketLabel).toBe("Total Corners");
    expect(v.pickLabel).toBe("Over 9.5");
  });

  it("builds warnings for started, unmapped and unpriced picks", () => {
    const later = new Date("2026-10-02T19:00:00Z");
    const views = [
      toSelectionView(base, now),
      toSelectionView({ ...base, position: 2, kickoffAt: later, market: null }, now),
      toSelectionView({ ...base, position: 3, kickoffAt: later, odds: null }, now),
    ];
    const w = buildWarnings(views);
    expect(w.map((x) => [x.code, x.positions])).toEqual([
      ["STARTED", [1]],
      ["UNMAPPED_MARKET", [2]],
      ["MISSING_ODDS", [3]],
    ]);
  });

  it("no warnings for a clean slip", () => {
    expect(buildWarnings([toSelectionView({ ...base, kickoffAt: new Date("2026-10-02T19:00:00Z") }, now)])).toEqual([]);
  });
});

describe("labels", () => {
  it("formats handicap and first-half markets", () => {
    const hcp = { type: "HANDICAP", period: "FT", outcome: "AWAY", line: -1 } as const;
    expect(marketLabel(hcp)).toBe("Handicap (Home -1)");
    expect(pickLabel(hcp, "Arsenal", "Newcastle")).toBe("Newcastle (+1)");
    expect(marketLabel({ type: "OVER_UNDER", period: "H1", outcome: "OVER", line: 0.5 })).toBe("1st Half Over/Under 0.5");
    expect(pickLabel({ type: "DOUBLE_CHANCE", period: "FT", outcome: "DRAW_AWAY", line: null }, "A", "B")).toBe("Draw or B");
  });
});
