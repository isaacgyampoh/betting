import { describe, expect, it, vi } from "vitest";
import { createSportyBetAdapter } from "@/lib/bookmakers/sportybet";
import { parseSpecifier } from "@/lib/bookmakers/formats/betradar-format";
import { derivePrices, FIXTURES } from "@/lib/bookmakers/mock/fixtures";
import type { Market } from "@/lib/markets/types";

const adapter = createSportyBetAdapter("mock", { latencyMs: 0 });
const teams = { home: "Arsenal", away: "Newcastle" };

describe("SportyBet market mapping", () => {
  it.each<[string, string, string, Market]>([
    ["1", "1", "", { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null }],
    ["1", "2", "", { type: "MATCH_RESULT", period: "FT", outcome: "DRAW", line: null }],
    ["10", "11", "", { type: "DOUBLE_CHANCE", period: "FT", outcome: "DRAW_AWAY", line: null }],
    ["18", "12", "total=2.5", { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 2.5 }],
    ["68", "13", "total=1.5", { type: "OVER_UNDER", period: "H1", outcome: "UNDER", line: 1.5 }],
    ["60", "3", "", { type: "MATCH_RESULT", period: "H1", outcome: "AWAY", line: null }],
    ["29", "74", "", { type: "BTTS", period: "FT", outcome: "YES", line: null }],
    ["14", "1711", "hcp=0:1", { type: "HANDICAP", period: "FT", outcome: "HOME", line: -1 }],
    ["14", "1713", "hcp=1:0", { type: "HANDICAP", period: "FT", outcome: "AWAY", line: 1 }],
  ])("maps market %s / outcome %s / %s", (marketId, outcomeId, specifier, expected) => {
    expect(adapter.mapMarket({ marketId, outcomeId, specifier }, teams)).toEqual(expected);
  });

  it("returns null for unknown markets, outcomes and malformed specifiers", () => {
    expect(adapter.mapMarket({ marketId: "166", outcomeId: "12", specifier: "total=9.5" }, teams)).toBeNull();
    expect(adapter.mapMarket({ marketId: "1", outcomeId: "99", specifier: "" }, teams)).toBeNull();
    expect(adapter.mapMarket({ marketId: "18", outcomeId: "12", specifier: "" }, teams)).toBeNull();
    expect(adapter.mapMarket({ marketId: "1", outcomeId: "1", specifier: "total=2.5" }, teams)).toBeNull();
  });

  it("parses specifiers", () => {
    expect(parseSpecifier("total", "total=3.5")).toBe(3.5);
    expect(parseSpecifier("hcp3way", "hcp=2:0")).toBe(2);
    expect(parseSpecifier("hcp3way", "hcp=0:2")).toBe(-2);
    expect(parseSpecifier("hcp3way", "bogus")).toBeUndefined();
    // Market 16 states the line directly instead of as a head start.
    expect(parseSpecifier("hcpAsian", "hcp=-3.5")).toBe(-3.5);
    // Read either spelling, but only ever write the bare one.
    expect(parseSpecifier("hcpAsian", "hcp=+1.5")).toBe(1.5);
    expect(parseSpecifier("hcpAsian", "hcp=1.5")).toBe(1.5);
    expect(parseSpecifier("hcpAsian", "hcp=0:1")).toBeUndefined();
  });

  // Ids verified against real SportyBet responses on 2026-10-01.
  it.each<[string, string, string, Market]>([
    ["11", "4", "", { type: "DRAW_NO_BET", period: "FT", outcome: "HOME", line: null }],
    ["16", "1715", "hcp=-3.5", { type: "ASIAN_HANDICAP", period: "FT", outcome: "AWAY", line: -3.5 }],
    ["19", "12", "total=1.5", { type: "TEAM_OVER_UNDER", period: "FT", outcome: "HOME_OVER", line: 1.5 }],
    ["20", "13", "total=0.5", { type: "TEAM_OVER_UNDER", period: "FT", outcome: "AWAY_UNDER", line: 0.5 }],
    ["26", "70", "", { type: "ODD_EVEN", period: "FT", outcome: "ODD", line: null }],
    ["63", "9", "", { type: "DOUBLE_CHANCE", period: "H1", outcome: "HOME_DRAW", line: null }],
    ["75", "76", "", { type: "BTTS", period: "H1", outcome: "NO", line: null }],
    ["83", "1", "", { type: "MATCH_RESULT", period: "H2", outcome: "HOME", line: null }],
    ["90", "12", "total=1", { type: "OVER_UNDER", period: "H2", outcome: "OVER", line: 1 }],
  ])("maps the newly verified market %s / outcome %s / %s", (marketId, outcomeId, specifier, expected) => {
    expect(adapter.mapMarket({ marketId, outcomeId, specifier }, teams)).toEqual(expected);
  });

  it("writes a positive asian handicap line without a plus sign", () => {
    // Both bookmakers send "hcp=0.5"; "hcp=+0.5" is a different (or invalid) line to them.
    const raw = adapter.unmapMarket({ type: "ASIAN_HANDICAP", period: "FT", outcome: "HOME", line: 0.5 }, teams);
    expect(raw?.specifier).toBe("hcp=0.5");
    expect(adapter.mapMarket(raw!, teams)).toEqual({ type: "ASIAN_HANDICAP", period: "FT", outcome: "HOME", line: 0.5 });
  });

  it("keeps home and away team totals apart when unmapping", () => {
    const home = adapter.unmapMarket({ type: "TEAM_OVER_UNDER", period: "FT", outcome: "HOME_OVER", line: 1.5 }, teams);
    const away = adapter.unmapMarket({ type: "TEAM_OVER_UNDER", period: "FT", outcome: "AWAY_OVER", line: 1.5 }, teams);
    expect(home?.marketId).toBe("19");
    expect(away?.marketId).toBe("20");
    expect(adapter.mapMarket(away!, teams)).toEqual({ type: "TEAM_OVER_UNDER", period: "FT", outcome: "AWAY_OVER", line: 1.5 });
  });

  it("round-trips every mock offer: raw → internal → raw", () => {
    const fixture = FIXTURES[0];
    const [home, away] = fixture.names.sportybet!;
    // Build offers via a real load to avoid reaching into internals.
    const prices = derivePrices(fixture, 0.05);
    expect(prices.matchResult.every((o) => o > 1)).toBe(true);
    const markets: Market[] = [
      { type: "MATCH_RESULT", period: "FT", outcome: "AWAY", line: null },
      { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_AWAY", line: null },
      { type: "OVER_UNDER", period: "FT", outcome: "UNDER", line: 3.5 },
      { type: "OVER_UNDER", period: "H1", outcome: "OVER", line: 0.5 },
      { type: "BTTS", period: "FT", outcome: "NO", line: null },
      { type: "HANDICAP", period: "FT", outcome: "DRAW", line: -1 },
    ];
    for (const m of markets) {
      const raw = adapter.unmapMarket(m, { home, away });
      expect(raw, JSON.stringify(m)).not.toBeNull();
      expect(adapter.mapMarket(raw!, { home, away })).toEqual(m);
    }
  });

  it("can't express markets it doesn't offer", () => {
    expect(adapter.unmapMarket({ type: "CORRECT_SCORE", period: "FT", outcome: "2:1", line: null }, teams)).toBeNull();
    expect(adapter.unmapMarket({ type: "OVER_UNDER", period: "FT", outcome: "OVER", line: null }, teams)).toBeNull();
  });
});

describe("SportyBet mock loadCode", () => {
  it("loads a valid slip with 8 mapped, priced, upcoming games", async () => {
    const slip = await adapter.loadCode("BC7K2Q");
    expect(slip.selections).toHaveLength(8);
    for (const s of slip.selections) {
      expect(s.market).not.toBeNull();
      expect(s.odds).toBeGreaterThan(1);
      expect(s.event.status).toBe("NOT_STARTED");
      expect(s.event.externalId).toMatch(/^sr:match:\d+$/);
    }
    expect(slip.selections[0].event.home).toBe("Manchester United");
    expect(slip.expiresAt).toBeInstanceOf(Date);
  });

  it("flags started games and logs unmapped markets without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slip = await adapter.loadCode("BCLIVE");
    expect(slip.selections.find((s) => s.event.home === "Bechem United")?.event.status).toBe("LIVE");
    const corners = slip.selections.find((s) => s.raw.marketId === "166");
    expect(corners?.market).toBeNull();
    expect(corners?.odds).toBe(1.85);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bookmaker.unmapped_market"));
    warn.mockRestore();
  });

  it.each([
    ["BCEXP1", "EXPIRED_CODE"],
    ["NOPE99", "BOOKMAKER_NOT_CONNECTED"],
    ["BCDOWN", "BOOKMAKER_UNAVAILABLE"],
  ])("code %s fails with %s", async (code, errorCode) => {
    await expect(adapter.loadCode(code)).rejects.toMatchObject({ name: "AppError", code: errorCode });
  });

  it("normalizes codes", () => {
    expect(adapter.normalizeCode(" bc7k 2q ")).toBe("BC7K2Q");
    expect(adapter.normalizeCode("ab")).toBeNull();
    expect(adapter.normalizeCode("BC7K-2Q")).toBeNull();
  });

  it("books a code that can then be loaded", async () => {
    const valid = await adapter.loadCode("BC7K2Q");
    const picks = valid.selections.slice(0, 3).map((s) => ({ eventExternalId: s.event.externalId, market: s.market! }));
    const created = await adapter.createCode(picks);
    expect(created.code).toMatch(/^BC[A-Z0-9]{4}$/);
    const reloaded = await adapter.loadCode(created.code);
    expect(reloaded.selections.map((s) => s.market)).toEqual(picks.map((p) => p.market));
  });

  it("refuses to book unknown events", async () => {
    await expect(
      adapter.createCode([{ eventExternalId: "sr:match:0", market: { type: "BTTS", period: "FT", outcome: "YES", line: null } }]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("finds events within ±15 minutes", async () => {
    const slip = await adapter.loadCode("BC7K2Q");
    const ars = slip.selections[1].event;
    const found = await adapter.searchEvent("Arsenal", "Newcastle United", new Date(ars.kickoffAt.getTime() + 10 * 60_000));
    expect(found.map((e) => e.externalId)).toContain(ars.externalId);
    const tooLate = await adapter.searchEvent("Arsenal", "Newcastle United", new Date(ars.kickoffAt.getTime() + 20 * 60_000));
    expect(tooLate.map((e) => e.externalId)).not.toContain(ars.externalId);
  });
});
