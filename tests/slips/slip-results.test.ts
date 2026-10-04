import { describe, expect, it } from "vitest";
import { canSettleFromScore, settleLeg } from "@/lib/services/slip-results";
import type { Market } from "@/lib/markets/types";
import type { MatchStatus, MatchSummary } from "@/lib/stats/types";

// Settling decides whether someone believes they have won. The rule that matters: a pick may be
// called WON early when nothing can take it back, but may only be called LOST once it really is.

const match = (home: number | null, away: number | null, status: MatchStatus, label = ""): MatchSummary => ({
  id: 1,
  kickoffAt: new Date().toISOString(),
  status,
  statusLabel: label,
  league: { id: 1, name: "L", country: "C", season: 2026, logo: null },
  home: { id: 1, name: "H", logo: null },
  away: { id: 2, name: "A", logo: null },
  goals: { home, away },
});

const m = (type: Market["type"], outcome: string, line: number | null = null, period: Market["period"] = "FT"): Market => ({
  type,
  period,
  outcome,
  line,
});

describe("over/under", () => {
  const over15 = m("OVER_UNDER", "OVER", 1.5);
  const under25 = m("OVER_UNDER", "UNDER", 2.5);

  it("wins an over as soon as the goals are in, mid-game", () => {
    expect(settleLeg(over15, match(1, 1, "LIVE", "52'")).state).toBe("WON");
  });

  it("keeps an over running while it is still short", () => {
    expect(settleLeg(over15, match(1, 0, "LIVE", "52'")).state).toBe("RUNNING");
  });

  it("only loses an over at full time", () => {
    expect(settleLeg(over15, match(0, 0, "LIVE", "88'")).state).toBe("RUNNING");
    expect(settleLeg(over15, match(1, 0, "FINISHED", "FT")).state).toBe("LOST");
  });

  it("loses an under the moment the line is passed, but wins it only at full time", () => {
    expect(settleLeg(under25, match(2, 1, "LIVE", "60'")).state).toBe("LOST");
    expect(settleLeg(under25, match(1, 0, "LIVE", "60'")).state).toBe("RUNNING");
    expect(settleLeg(under25, match(1, 1, "FINISHED", "FT")).state).toBe("WON");
  });
});

describe("both teams to score", () => {
  it("wins yes as soon as both have scored", () => {
    expect(settleLeg(m("BTTS", "YES"), match(1, 1, "LIVE", "30'")).state).toBe("WON");
    expect(settleLeg(m("BTTS", "YES"), match(2, 0, "LIVE", "30'")).state).toBe("RUNNING");
    expect(settleLeg(m("BTTS", "YES"), match(2, 0, "FINISHED", "FT")).state).toBe("LOST");
  });

  it("loses no as soon as both have scored", () => {
    expect(settleLeg(m("BTTS", "NO"), match(1, 1, "LIVE", "30'")).state).toBe("LOST");
    expect(settleLeg(m("BTTS", "NO"), match(1, 0, "LIVE", "30'")).state).toBe("RUNNING");
    expect(settleLeg(m("BTTS", "NO"), match(1, 0, "FINISHED", "FT")).state).toBe("WON");
  });
});

describe("result markets", () => {
  it("never calls a result won before full time, however far ahead", () => {
    const r = settleLeg(m("MATCH_RESULT", "HOME"), match(3, 0, "LIVE", "80'"));
    expect(r.state).toBe("RUNNING");
    expect(r.note).toContain("currently covered");
  });

  it("settles 1X2 at full time", () => {
    expect(settleLeg(m("MATCH_RESULT", "HOME"), match(2, 1, "FINISHED", "FT")).state).toBe("WON");
    expect(settleLeg(m("MATCH_RESULT", "HOME"), match(1, 1, "FINISHED", "FT")).state).toBe("LOST");
    expect(settleLeg(m("MATCH_RESULT", "DRAW"), match(1, 1, "FINISHED", "FT")).state).toBe("WON");
    expect(settleLeg(m("MATCH_RESULT", "AWAY"), match(0, 2, "FINISHED", "FT")).state).toBe("WON");
  });

  it("settles every double chance correctly", () => {
    const fin = (h: number, a: number) => match(h, a, "FINISHED", "FT");
    expect(settleLeg(m("DOUBLE_CHANCE", "HOME_DRAW"), fin(1, 1)).state).toBe("WON");
    expect(settleLeg(m("DOUBLE_CHANCE", "HOME_DRAW"), fin(0, 1)).state).toBe("LOST");
    expect(settleLeg(m("DOUBLE_CHANCE", "DRAW_AWAY"), fin(0, 0)).state).toBe("WON");
    expect(settleLeg(m("DOUBLE_CHANCE", "DRAW_AWAY"), fin(1, 0)).state).toBe("LOST");
    expect(settleLeg(m("DOUBLE_CHANCE", "HOME_AWAY"), fin(1, 0)).state).toBe("WON");
    expect(settleLeg(m("DOUBLE_CHANCE", "HOME_AWAY"), fin(2, 2)).state).toBe("LOST");
  });
});

describe("what we refuse to settle", () => {
  it("won't settle a first-half line from the full-time score", () => {
    expect(settleLeg(m("OVER_UNDER", "OVER", 0.5, "H1"), match(3, 0, "FINISHED", "FT")).state).toBe("UNKNOWN");
  });

  it("won't settle a market we don't model, like corners", () => {
    const r = settleLeg(null, match(2, 2, "FINISHED", "FT"));
    expect(r.state).toBe("UNKNOWN");
    expect(r.note).toContain("check this market at the bookmaker");
  });

  it("reports a game that hasn't kicked off", () => {
    expect(settleLeg(m("BTTS", "YES"), match(null, null, "SCHEDULED")).state).toBe("NOT_STARTED");
  });
});

// Nothing we cannot settle from a final score is published as a daily pick: the public record says
// every pick on it ends up won or lost, and a leg that can never be either keeps its whole slip off
// the record for ever.
describe("canSettleFromScore", () => {
  const m = (over: Record<string, unknown>) => ({ type: "OVER_UNDER", period: "FT", line: 2.5, outcome: "OVER", ...over }) as never;

  it.each([
    ["full-time over/under", m({})],
    ["both teams to score", m({ type: "BTTS", line: null, outcome: "YES" })],
    ["match result", m({ type: "MATCH_RESULT", line: null, outcome: "HOME" })],
    ["double chance", m({ type: "DOUBLE_CHANCE", line: null, outcome: "HOME_DRAW" })],
  ])("settles %s", (_label, market) => {
    expect(canSettleFromScore(market)).toBe(true);
  });

  it.each([
    ["a first-half line", m({ period: "H1" })],
    ["an over/under with no line", m({ line: null })],
    ["corners", m({ type: "CORNERS" })],
    ["cards", m({ type: "CARDS" })],
    ["a team total", m({ type: "TEAM_OVER_UNDER" })],
    ["nothing at all", null],
  ])("does not settle %s", (_label, market) => {
    expect(canSettleFromScore(market)).toBe(false);
  });
});
