import { describe, expect, it } from "vitest";
import { BETPAWA_NEVER_MAP, betpawaFormat } from "@/lib/bookmakers/formats/betpawa-format";
import type { RawMarket } from "@/lib/bookmakers/types";

/**
 * What betPawa's markets mean, and what we refuse to claim they mean.
 *
 * Converting a slip rebuilds each pick at another bookmaker, so a market mapped to the wrong type
 * does not fail - it quietly becomes a different bet. These tests are mostly about the refusals.
 */
const raw = (marketId: string, outcomeId: string, specifier = ""): RawMarket => ({
  marketId,
  outcomeId,
  specifier,
  marketName: marketId,
  outcomeName: outcomeId,
});

describe("markets betPawa names and we understand", () => {
  it("reads a match result", () => {
    expect(betpawaFormat.mapMarket(raw("1X2 - FT", "1"))).toEqual({ type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null });
    expect(betpawaFormat.mapMarket(raw("1X2 - FT", "X"))?.outcome).toBe("DRAW");
    expect(betpawaFormat.mapMarket(raw("1X2 - FT", "2"))?.outcome).toBe("AWAY");
  });

  // The name is "Total Score Over/Under", not "Over/Under" - an earlier guess at the shorter name
  // matched nothing and silently failed to convert every total betPawa sells.
  it("reads a total, with its line", () => {
    expect(betpawaFormat.mapMarket(raw("Total Score Over/Under - FT", "Over", "2.5"))).toEqual({
      type: "OVER_UNDER",
      period: "FT",
      outcome: "OVER",
      line: 2.5,
    });
    expect(betpawaFormat.mapMarket(raw("Total Score Over/Under - FT", "Under", "3.5"))?.outcome).toBe("UNDER");
  });

  it("reads both teams to score", () => {
    expect(betpawaFormat.mapMarket(raw("Both Teams To Score - FT", "Yes"))?.outcome).toBe("YES");
    expect(betpawaFormat.mapMarket(raw("Both Teams To Score - FT", "No"))?.outcome).toBe("NO");
  });

  // "Handicap 1X2" is three-way: the draw is a real outcome against the line, so leaving it out
  // would drop a pick somebody made.
  it("reads a three-way handicap, including the draw", () => {
    expect(betpawaFormat.mapMarket(raw("Handicap 1X2 - FT", "1", "-4"))).toEqual({
      type: "HANDICAP",
      period: "FT",
      outcome: "HOME",
      line: -4,
    });
    expect(betpawaFormat.mapMarket(raw("Handicap 1X2 - FT", "X", "-1"))?.outcome).toBe("DRAW");
    expect(betpawaFormat.mapMarket(raw("Handicap 1X2 - FT", "2", "+2"))?.outcome).toBe("AWAY");
  });
});

describe("markets we refuse rather than guess", () => {
  /**
   * The one that matters. "1X2 1UP" pays out early once the side goes a goal ahead, so it wins
   * matches a 1X2 pick loses. It is in the real payload of the code this was built against, and
   * mapping it to MATCH_RESULT would turn one bet into another at the destination.
   */
  it("never maps a 1UP promotion to a match result", () => {
    expect(betpawaFormat.mapMarket(raw("1X2 1UP - FT", "1"))).toBeNull();
    expect(betpawaFormat.mapMarket(raw("1X2 2UP - FT", "1"))).toBeNull();
    expect(betpawaFormat.refusedReason(raw("1X2 1UP - FT", "1"))).toContain("different bet");
  });

  it("says why, so the refusal is not read as a gap to fill in", () => {
    for (const name of Object.keys(BETPAWA_NEVER_MAP)) {
      expect(betpawaFormat.refusedReason(raw(name, "1"))).toBeTruthy();
      expect(betpawaFormat.mapMarket(raw(name, "1"))).toBeNull();
    }
  });

  // A combination bet: the result and the total both have to come in. Our Market model carries
  // one pick, so mapping it to either half would hand someone an easier bet than they made.
  it("refuses a market that is two conditions in one", () => {
    expect(betpawaFormat.mapMarket(raw("1X2 and Totals - FT", "1 - Over", "1.5"))).toBeNull();
    expect(betpawaFormat.refusedReason(raw("1X2 and Totals - FT", "1 - Over"))).toContain("single pick");
  });

  it("refuses a market name it has never seen rather than inferring from the pattern", () => {
    expect(betpawaFormat.mapMarket(raw("Corners - FT", "Over", "9.5"))).toBeNull();
    expect(betpawaFormat.mapMarket(raw("1X2 - 2H", "1"))).toBeNull();
    expect(betpawaFormat.refusedReason(raw("Corners - FT", "Over"))).toBeNull();
    // The two names that were guessed and turned out wrong. They must stay unmapped, so that a
    // future payload using them is noticed rather than quietly half-working.
    expect(betpawaFormat.mapMarket(raw("Over/Under - FT", "Over", "2.5"))).toBeNull();
    expect(betpawaFormat.mapMarket(raw("Handicap - FT", "1", "-1"))).toBeNull();
  });

  // A total with no line cannot be rebuilt anywhere, so it is not a conversion we can offer.
  it("refuses a total or handicap with no line", () => {
    expect(betpawaFormat.mapMarket(raw("Total Score Over/Under - FT", "Over", ""))).toBeNull();
    expect(betpawaFormat.mapMarket(raw("Handicap 1X2 - FT", "1", ""))).toBeNull();
  });

  it("refuses an outcome label it does not recognise", () => {
    expect(betpawaFormat.mapMarket(raw("1X2 - FT", "3"))).toBeNull();
    expect(betpawaFormat.mapMarket(raw("Both Teams To Score - FT", "Maybe"))).toBeNull();
  });
});
