import { describe, expect, it } from "vitest";
import { candidatesFrom, dedupe, parseLine, parseOutcome } from "@/lib/special-picks/candidates";
import type { BookmakerEventInfo } from "@/lib/bookmakers/types";

/**
 * Candidates come from the bookmaker, never from a wish list.
 *
 * The brief's odds rule is an ordering rule: a statistical prediction is not automatically a
 * betting option, so only selections a bookmaker is already pricing are considered. Nothing in
 * this layer can fabricate a price because nothing in it constructs one.
 */
const event = (over: Partial<BookmakerEventInfo> = {}): BookmakerEventInfo => ({
  externalId: "sr:match:1",
  home: "Arsenal",
  away: "Chelsea",
  kickoffAt: new Date("2026-11-02T19:00:00Z"),
  competition: "Premier League",
  country: "England",
  status: "NOT_STARTED",
  ...over,
});

const offer = (marketName: string, specifier: string, outcomeName: string, odds: number) => ({
  raw: { marketId: "166", outcomeId: "12", specifier, marketName, outcomeName },
  odds,
});

describe("reading a priced offer", () => {
  it("takes the line out of the bookmaker's specifier", () => {
    expect(parseLine("total=9.5")).toBe(9.5);
    expect(parseLine("total=10.5")).toBe(10.5);
    expect(parseLine("")).toBeNull();
    expect(parseLine(undefined)).toBeNull();
    // A specifier with no number is not a totals market, whatever the name claims.
    expect(parseLine("hcp=home")).toBeNull();
  });

  it("reads over or under from the outcome's own name", () => {
    expect(parseOutcome("Over")).toBe("OVER");
    expect(parseOutcome("Under 9.5")).toBe("UNDER");
    expect(parseOutcome("Yes")).toBeNull();
    expect(parseOutcome(undefined)).toBeNull();
  });
});

describe("what becomes a candidate", () => {
  it("accepts a corners line with a real price", () => {
    const got = candidatesFrom("sportybet", [
      { event: event(), offers: [offer("Corners - Over/Under", "total=9.5", "Over", 1.85)] },
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      bookmaker: "sportybet",
      rawMarketName: "Corners - Over/Under",
      line: 9.5,
      outcome: "OVER",
      odds: 1.85,
    });
    expect(got[0].market).toEqual({ kind: "CORNERS", side: "MATCH", period: "FT" });
  });

  it("accepts the other bookmaker's spelling of the same market", () => {
    const got = candidatesFrom("footballcom", [
      { event: event(), offers: [offer("Corners O/U", "total=9.5", "Over", 1.9)] },
    ]);
    expect(got[0]?.market.kind).toBe("CORNERS");
  });

  it("accepts team shots and shots on target", () => {
    const got = candidatesFrom("sportybet", [
      {
        event: event(),
        offers: [
          offer("Home Team Shots Over/Under", "total=12.5", "Over", 1.8),
          offer("Away Team Shots on Target O/U", "total=3.5", "Under", 2.1),
        ],
      },
    ]);
    expect(got.map((c) => `${c.market.kind}/${c.market.side}/${c.outcome}`)).toEqual([
      "SHOTS/HOME/OVER",
      "SHOTS_ON_TARGET/AWAY/UNDER",
    ]);
  });
});

describe("what is refused", () => {
  // The rule the whole feature turns on.
  it("refuses result and goals markets even though they are priced", () => {
    const got = candidatesFrom("sportybet", [
      {
        event: event(),
        offers: [
          offer("1X2", "", "Home", 2.1),
          offer("Over/Under", "total=2.5", "Over", 1.9),
          offer("Both Teams To Score", "", "Yes", 1.7),
          offer("Double Chance", "", "Home Or Draw", 1.3),
          offer("Asian Handicap", "hcp=-0.5", "Home", 1.95),
        ],
      },
    ]);
    expect(got).toEqual([]);
  });

  it("refuses markets the bookmaker prices but we cannot settle", () => {
    const got = candidatesFrom("sportybet", [
      {
        event: event(),
        offers: [
          offer("Player Fouls", "total=1.5", "Over", 1.9),
          offer("Match Cards", "total=3.5", "Over", 1.8),
          offer("1st Half - Total Corners", "total=4.5", "Over", 1.9),
        ],
      },
    ]);
    expect(got).toEqual([]);
  });

  it("refuses a fixture that has already started", () => {
    for (const status of ["LIVE", "ENDED"] as const) {
      const got = candidatesFrom("sportybet", [
        { event: event({ status }), offers: [offer("Corners O/U", "total=9.5", "Over", 1.85)] },
      ]);
      expect(got, `a ${status} fixture must not be published`).toEqual([]);
    }
  });

  // A whole line can settle as a push, and this feature has no push path distinct from a void.
  it("refuses a whole-number line", () => {
    const got = candidatesFrom("sportybet", [
      { event: event(), offers: [offer("Corners O/U", "total=10", "Over", 1.85)] },
    ]);
    expect(got).toEqual([]);
  });

  it("refuses an offer with no usable price", () => {
    for (const odds of [1, 0, -2, Number.NaN]) {
      const got = candidatesFrom("sportybet", [
        { event: event(), offers: [offer("Corners O/U", "total=9.5", "Over", odds)] },
      ]);
      expect(got, `odds ${odds} must not become a candidate`).toEqual([]);
    }
  });

  it("refuses an offer missing its line or its outcome", () => {
    const got = candidatesFrom("sportybet", [
      {
        event: event(),
        offers: [offer("Corners O/U", "", "Over", 1.85), offer("Corners O/U", "total=9.5", "Yes", 1.85)],
      },
    ]);
    expect(got).toEqual([]);
  });

  it("refuses a market name nobody has catalogued", () => {
    const got = candidatesFrom("sportybet", [
      { event: event(), offers: [offer("Total Deflections O/U", "total=5.5", "Over", 1.9)] },
    ]);
    expect(got).toEqual([]);
  });
});

describe("one opinion per market", () => {
  // The probe found eighteen Shots Over/Under offers on one fixture; they are one opinion at
  // different thresholds, and carrying them all would let a single fixture fill both daily slots
  // with substantially one bet.
  it("keeps the best price for an identical selection", () => {
    const got = dedupe(
      candidatesFrom("sportybet", [
        {
          event: event(),
          offers: [
            offer("Corners O/U", "total=9.5", "Over", 1.8),
            offer("Corners O/U", "total=9.5", "Over", 1.95),
            offer("Corners O/U", "total=9.5", "Over", 1.7),
          ],
        },
      ]),
    );
    expect(got).toHaveLength(1);
    expect(got[0].odds).toBe(1.95);
  });

  it("keeps genuinely different lines apart", () => {
    const got = dedupe(
      candidatesFrom("sportybet", [
        {
          event: event(),
          offers: [
            offer("Corners O/U", "total=9.5", "Over", 1.8),
            offer("Corners O/U", "total=10.5", "Over", 2.1),
            offer("Corners O/U", "total=9.5", "Under", 2.0),
          ],
        },
      ]),
    );
    expect(got).toHaveLength(3);
  });
});
