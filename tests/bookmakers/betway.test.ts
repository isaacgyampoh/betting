import { describe, expect, it, vi } from "vitest";
import { createBetwayAdapter } from "@/lib/bookmakers/betway";
import type { Market } from "@/lib/markets/types";

const adapter = createBetwayAdapter("mock", { latencyMs: 0 });
const teams = { home: "Man Utd", away: "Tottenham Hotspur" };

describe("Betway market mapping", () => {
  it.each<[string, string, string, Market]>([
    ["Match Result (1X2)", "Man Utd", "", { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null }],
    ["Match Result (1X2)", "Draw", "", { type: "MATCH_RESULT", period: "FT", outcome: "DRAW", line: null }],
    ["Match Result (1X2)", "Tottenham Hotspur", "", { type: "MATCH_RESULT", period: "FT", outcome: "AWAY", line: null }],
    ["Double Chance", "Man Utd or Draw", "", { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_DRAW", line: null }],
    ["Double Chance", "Man Utd or Tottenham Hotspur", "", { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_AWAY", line: null }],
    ["Double Chance", "Draw or Tottenham Hotspur", "", { type: "DOUBLE_CHANCE", period: "FT", outcome: "DRAW_AWAY", line: null }],
    ["Total Goals Over/Under", "Over 2.5", "2.5", { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 2.5 }],
    ["1st Half - Total Goals", "Under 1.5", "1.5", { type: "OVER_UNDER", period: "H1", outcome: "UNDER", line: 1.5 }],
    ["1st Half - Match Result", "Draw", "", { type: "MATCH_RESULT", period: "H1", outcome: "DRAW", line: null }],
    ["Both Teams To Score", "No", "", { type: "BTTS", period: "FT", outcome: "NO", line: null }],
    ["Handicap", "Man Utd (-1)", "-1", { type: "HANDICAP", period: "FT", outcome: "HOME", line: -1 }],
    ["Handicap", "Tottenham Hotspur (+1)", "-1", { type: "HANDICAP", period: "FT", outcome: "AWAY", line: -1 }],
  ])("maps %s / %s", (marketId, outcomeId, specifier, expected) => {
    expect(adapter.mapMarket({ marketId, outcomeId, specifier }, teams)).toEqual(expected);
  });

  it("matches team labels despite punctuation and FC-style suffixes", () => {
    expect(
      adapter.mapMarket({ marketId: "Match Result (1X2)", outcomeId: "Brighton & Hove Albion", specifier: "" }, { home: "Brighton and Hove Albion FC", away: "Man City" }),
    ).toMatchObject({ outcome: "HOME" });
  });

  it("returns null for unknown markets and outcomes", () => {
    expect(adapter.mapMarket({ marketId: "Total Corners", outcomeId: "Over 9.5", specifier: "9.5" }, teams)).toBeNull();
    expect(adapter.mapMarket({ marketId: "Match Result (1X2)", outcomeId: "Chelsea", specifier: "" }, teams)).toBeNull();
    expect(adapter.mapMarket({ marketId: "Total Goals Over/Under", outcomeId: "Over 2.5", specifier: "" }, teams)).toBeNull();
    expect(adapter.mapMarket({ marketId: "Both Teams To Score", outcomeId: "Maybe", specifier: "" }, teams)).toBeNull();
  });

  it("round-trips internal → raw → internal", () => {
    const markets: Market[] = [
      { type: "MATCH_RESULT", period: "FT", outcome: "AWAY", line: null },
      { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_AWAY", line: null },
      { type: "OVER_UNDER", period: "H1", outcome: "OVER", line: 0.5 },
      { type: "BTTS", period: "FT", outcome: "YES", line: null },
      { type: "HANDICAP", period: "FT", outcome: "AWAY", line: 1 },
      { type: "HANDICAP", period: "FT", outcome: "DRAW", line: -1 },
    ];
    for (const m of markets) {
      const raw = adapter.unmapMarket(m, teams);
      expect(raw, JSON.stringify(m)).not.toBeNull();
      expect(adapter.mapMarket(raw!, teams)).toEqual(m);
    }
  });
});

describe("Betway mock loadCode", () => {
  it("loads a valid slip with Betway team spellings", async () => {
    const slip = await adapter.loadCode("bw5v8n".toUpperCase());
    expect(slip.selections).toHaveLength(6);
    expect(slip.selections[0].event.home).toBe("Man Utd");
    expect(slip.selections.every((s) => s.market && s.odds && s.odds > 1)).toBe(true);
  });

  it("flags started games and keeps unmapped picks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slip = await adapter.loadCode("BWLIVE");
    expect(slip.selections).toHaveLength(4);
    expect(slip.selections.filter((s) => s.event.status === "LIVE")).toHaveLength(1);
    expect(slip.selections.filter((s) => s.market === null)).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it.each([
    ["BWEXP1", "EXPIRED_CODE"],
    ["ZZZZ9", "INVALID_CODE"],
    ["BWDOWN", "BOOKMAKER_UNAVAILABLE"],
  ])("code %s fails with %s", async (code, errorCode) => {
    await expect(adapter.loadCode(code)).rejects.toMatchObject({ code: errorCode });
  });

  it("live mode reports the bookmaker as unavailable instead of inventing endpoints", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const live = createBetwayAdapter("live");
    await expect(live.loadCode("BW5V8N")).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    err.mockRestore();
  });
});
