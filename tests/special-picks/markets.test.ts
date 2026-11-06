import { describe, expect, it } from "vitest";
import { actualFor, isForbiddenMarket, marketLabel, parseSpecialMarket, SUPPORTED_MARKETS } from "@/lib/special-picks/markets";
import type { TeamStatistics } from "@/lib/stats/types";

/**
 * What Daily Special Picks is allowed to publish.
 *
 * The brief's hardest requirement is a negative one: the daily quota must never be filled with
 * ordinary match-result or goals predictions. That is not a hypothetical risk. Those markets are
 * the easiest to find odds for and the easiest to settle, so any ranking function under pressure
 * drifts towards them - and a 1X2 tip published as "statistical research" is the exact failure the
 * feature exists to avoid. Hence the list below of real market names read off a live fixture.
 */
const stat = (over: Partial<TeamStatistics>): TeamStatistics => ({
  team: { id: 1, name: "T", logo: null },
  possession: null,
  shotsTotal: null,
  shotsOnGoal: null,
  shotsOffGoal: null,
  shotsBlocked: null,
  shotsInsideBox: null,
  shotsOutsideBox: null,
  corners: null,
  offsides: null,
  fouls: null,
  yellowCards: null,
  redCards: null,
  saves: null,
  passesTotal: null,
  passesAccurate: null,
  expectedGoals: null,
  ...over,
});

describe("markets we publish", () => {
  // Both spellings were read off the same fixture in the same probe run: the two bookmakers share
  // a platform and still name these differently.
  it.each([
    ["Corners - Over/Under", "CORNERS", "MATCH"],
    ["Corners O/U", "CORNERS", "MATCH"],
    ["Home Team Total Corners", "CORNERS", "HOME"],
    ["Away Team Total Corners", "CORNERS", "AWAY"],
    ["Shots Over/Under", "SHOTS", "MATCH"],
    ["Home Team Shots Over/Under", "SHOTS", "HOME"],
    ["Shots on Target Over/Under", "SHOTS_ON_TARGET", "MATCH"],
    ["Home Shots on Target Over/Under", "SHOTS_ON_TARGET", "HOME"],
    ["Away Team Shots on Target O/U", "SHOTS_ON_TARGET", "AWAY"],
    ["Fouls Over/Under", "FOULS", "MATCH"],
    ["Home Team Fouls Over/Under", "FOULS", "HOME"],
    ["Away Team Fouls Over/Under", "FOULS", "AWAY"],
    ["Offsides Over/Under", "OFFSIDES", "MATCH"],
    ["Home Offsides Over/Under", "OFFSIDES", "HOME"],
    ["Away Team Offsides Over/Under", "OFFSIDES", "AWAY"],
  ])("%s -> %s %s", (raw, kind, side) => {
    const m = parseSpecialMarket(raw);
    expect(m, `${raw} should be recognised`).not.toBeNull();
    expect(m!.kind).toBe(kind);
    expect(m!.side).toBe(side);
    expect(m!.period).toBe("FT");
  });

  it("is case and spacing insensitive, because the feed is not consistent", () => {
    expect(parseSpecialMarket("  CORNERS   O/U ")?.kind).toBe("CORNERS");
  });
});

describe("markets that must never be published", () => {
  // Every one of these was offered on the fixture measured, and every one is excluded by the brief.
  const banned = [
    "1X2",
    "Match Result",
    "Double Chance",
    "Draw No Bet",
    "Over/Under",
    "GG/NG",
    "Both Teams To Score",
    "Correct Score",
    "HT/FT",
    "Half Time / Full Time",
    "Asian Handicap",
    "Home Team Clean Sheet",
    "Home Team Win To Nil",
    "Home Team To Win Both Halves",
  ];

  it.each(banned)("%s does not parse", (raw) => {
    expect(parseSpecialMarket(raw), `${raw} must never become a pick`).toBeNull();
  });

  it("flags the result and goals families explicitly", () => {
    expect(isForbiddenMarket("1X2")).toBe(true);
    expect(isForbiddenMarket("Double Chance")).toBe(true);
    expect(isForbiddenMarket("Corners - Over/Under")).toBe(false);
  });

  // The quota-filling failure, stated as a test: a goals line is a goals line however it is spelt,
  // and "Over/Under" alone is the generic goals market.
  it("never lets a plain Over/Under through as a statistical market", () => {
    expect(parseSpecialMarket("Over/Under")).toBeNull();
    expect(parseSpecialMarket("1st Half - Over/Under")).toBeNull();
  });
});

describe("markets priced by the bookmaker that we still refuse", () => {
  // Each of these is real and was offered. Each is refused for a reason recorded in markets.ts:
  // no statistic to research or settle it with.
  it.each([
    "Player Fouls",
    "Player Fouls Won",
    "Player passes",
    "Player Saves",
    "Player To Be Carded",
    "Match Cards",
    "Match Cards 1st Half",
    "Match Shots Outside Box",
    "Shots 1X2",
    "1st Half - Total Corners",
    "Team 2nd half shots on target",
  ])("%s is not published", (raw) => {
    expect(parseSpecialMarket(raw)).toBeNull();
  });

  it("refuses a name nobody has seen before, rather than guessing", () => {
    // A raw market name is a bookmaker's private vocabulary and can change without notice.
    expect(parseSpecialMarket("Total Deflections Over/Under")).toBeNull();
    expect(parseSpecialMarket("")).toBeNull();
  });
});

describe("what a selection is graded against", () => {
  const stats = [stat({ corners: 6, shotsTotal: 14, shotsOnGoal: 5 }), stat({ corners: 4, shotsTotal: 9, shotsOnGoal: 3 })];

  it("sums both sides for a match line", () => {
    expect(actualFor({ kind: "CORNERS", side: "MATCH", period: "FT" }, stats)).toBe(10);
    expect(actualFor({ kind: "SHOTS", side: "MATCH", period: "FT" }, stats)).toBe(23);
  });

  it("takes one side for a team line", () => {
    expect(actualFor({ kind: "CORNERS", side: "HOME", period: "FT" }, stats)).toBe(6);
    expect(actualFor({ kind: "SHOTS_ON_TARGET", side: "AWAY", period: "FT" }, stats)).toBe(3);
  });

  // The worst possible way to be wrong: silent, plausible and permanent in the published record.
  it("returns null rather than zero when the statistic is missing", () => {
    const missing = [stat({ corners: null }), stat({ corners: 4 })];
    expect(actualFor({ kind: "CORNERS", side: "MATCH", period: "FT" }, missing)).toBeNull();
    expect(actualFor({ kind: "CORNERS", side: "HOME", period: "FT" }, missing)).toBeNull();
    // The side that does have a figure is still gradeable.
    expect(actualFor({ kind: "CORNERS", side: "AWAY", period: "FT" }, missing)).toBe(4);
  });

  it("returns null when there are no statistics at all", () => {
    expect(actualFor({ kind: "CORNERS", side: "MATCH", period: "FT" }, [])).toBeNull();
  });
});

describe("the supported set", () => {
  it("is small, and contains nothing from the forbidden families", () => {
    // Five statistics across match, home and away. Small on purpose: every one of them is a
    // statistic the provider populates on a real fixture and the bookmaker prices at team level.
    expect(SUPPORTED_MARKETS.length).toBe(15);
    for (const m of SUPPORTED_MARKETS) {
      expect(["CORNERS", "SHOTS", "SHOTS_ON_TARGET", "FOULS", "OFFSIDES"]).toContain(m.kind);
      expect(isForbiddenMarket(marketLabel(m))).toBe(false);
    }
  });

  it("covers each statistic on the match and on either team", () => {
    for (const kind of ["CORNERS", "SHOTS", "SHOTS_ON_TARGET", "FOULS", "OFFSIDES"]) {
      const sides = SUPPORTED_MARKETS.filter((m) => m.kind === kind).map((m) => m.side).sort();
      expect(sides).toEqual(["AWAY", "HOME", "MATCH"]);
    }
  });

  it("labels a selection in words a reader understands", () => {
    expect(marketLabel({ kind: "CORNERS", side: "HOME", period: "FT" })).toBe("Home team corners");
    expect(marketLabel({ kind: "SHOTS_ON_TARGET", side: "MATCH", period: "FT" })).toBe("Match shots on target");
  });
});

/**
 * The categories that stay out, and the measurement that keeps them there.
 *
 * Each of these is priced by the bookmaker, asked for by name, or both. They are excluded because
 * of what the stats provider does - or does not - return, measured over six finished, well-covered
 * fixtures on 4 November 2026. These tests exist so that adding one back is a deliberate act with
 * a reason attached, rather than something that happens because a market name looked plausible.
 */
describe("markets we can price but cannot settle", () => {
  // GOAL returns a Throw In row and it reads 0/0 on half of them. A real match has throw-ins, so
  // a reported zero is a gap wearing a number.
  it("refuses throw-ins, which the provider reports but does not populate", () => {
    for (const name of ["Throw-Ins Over/Under", "Home Team Throw-Ins Over/Under", "Throw-Ins 1X2"]) {
      expect(parseSpecialMarket(name)).toBeNull();
    }
  });

  // Never reported by the provider on any of the six.
  it("refuses tackles, clearances, blocks and interceptions", () => {
    for (const name of ["Tackles Over/Under", "Home Team Tackles Over/Under", "Clearances Over/Under", "Interceptions Over/Under"]) {
      expect(parseSpecialMarket(name)).toBeNull();
    }
  });

  // The provider has both on all six; the bookmaker prices them only per player.
  it("refuses saves and passes, which exist only as player markets", () => {
    for (const name of ["Player Saves", "Player passes", "Saves Over/Under", "Passes Over/Under"]) {
      expect(parseSpecialMarket(name)).toBeNull();
    }
  });

  // Red Cards appears only when a red was shown, and nothing can corroborate its absence.
  it("refuses cards and bookings until a red card can be corroborated", () => {
    for (const name of ["Bookings - Over/Under", "Match Cards", "Home Team Total Bookings", "Total Booking Points", "Exact Bookings"]) {
      expect(parseSpecialMarket(name)).toBeNull();
    }
  });

  it("refuses player markets, whose data is there for the top five and absent below", () => {
    for (const name of ["Player Fouls", "Player shots", "Player Offsides", "Player SoT outside box"]) {
      expect(parseSpecialMarket(name)).toBeNull();
    }
  });

  // The brief's hard exclusions, restated against the real names the book uses.
  it("still refuses every result and goals market", () => {
    for (const name of ["1X2", "Double Chance", "Over/Under", "Both Teams To Score", "Corners 1X2", "Fouls 1X2", "Shots 1X2"]) {
      expect(parseSpecialMarket(name)).toBeNull();
    }
  });
});
