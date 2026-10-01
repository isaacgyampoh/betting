import { describe, expect, it } from "vitest";
import { parseSharedSelections, probabilityOf } from "@/lib/bookmakers/live/sportybet";

// parseSharedSelections walks an unknown object graph because SportyBet's booking-code success
// envelope has not been captured yet (only its error envelope has). These cases pin down the
// behaviour we rely on: find picks wherever they are nested, accept the field-name variants the
// rest of their API uses, and return nothing rather than something wrong.

describe("parseSharedSelections", () => {
  it("reads picks from a nested slip shape", () => {
    const data = {
      shareCode: "BC7K2Q",
      outcomes: [
        { eventId: "sr:match:1", marketId: "18", outcomeId: "12", specifier: "total=2.5", odds: "1.85" },
        { eventId: "sr:match:2", marketId: "1", outcomeId: "1", specifier: "" },
      ],
    };
    expect(parseSharedSelections(data)).toEqual([
      { eventId: "sr:match:1", raw: { marketId: "18", outcomeId: "12", specifier: "total=2.5", marketName: "Over/Under", outcomeName: undefined } },
      { eventId: "sr:match:2", raw: { marketId: "1", outcomeId: "1", specifier: "", marketName: "1X2", outcomeName: undefined } },
    ]);
  });

  it("finds picks however deeply they are buried", () => {
    const data = { data: { order: { selections: [{ wrap: { eventId: "sr:match:9", marketId: "29", outcomeId: "74" } }] } } };
    expect(parseSharedSelections(data)).toHaveLength(1);
    expect(parseSharedSelections(data)[0].eventId).toBe("sr:match:9");
  });

  it("accepts the field-name variants used elsewhere in their API", () => {
    const picks = parseSharedSelections([{ matchId: "sr:match:3", marketTypeId: 10, oddsId: 9, outcomeDesc: "Home or Draw" }]);
    expect(picks).toEqual([
      { eventId: "sr:match:3", raw: { marketId: "10", outcomeId: "9", specifier: "", marketName: "Double Chance", outcomeName: "Home or Draw" } },
    ]);
  });

  it("de-duplicates a pick repeated under several keys", () => {
    const pick = { eventId: "sr:match:4", marketId: "1", outcomeId: "3", specifier: "" };
    expect(parseSharedSelections({ a: [pick], b: { c: [{ ...pick }] } })).toHaveLength(1);
  });

  it("returns nothing for a shape it does not recognise, rather than guessing", () => {
    expect(parseSharedSelections({ bizCode: 10000, data: { totalStake: 10 } })).toEqual([]);
    expect(parseSharedSelections(null)).toEqual([]);
    expect(parseSharedSelections([{ eventId: "sr:match:1", marketId: "18" }])).toEqual([]);
  });

  it("survives a cyclic graph", () => {
    const node: Record<string, unknown> = { eventId: "sr:match:5", marketId: "1", outcomeId: "2", specifier: "" };
    node.self = node;
    expect(parseSharedSelections([node])).toHaveLength(1);
  });
});

describe("probabilityOf", () => {
  it("passes through the probability SportyBet publishes", () => {
    expect(probabilityOf({ id: "1", odds: "1.22", probability: "0.8125890000" })).toBeCloseTo(0.812589);
  });

  it("returns null rather than inventing one", () => {
    expect(probabilityOf({ id: "1", odds: "1.22" })).toBeNull();
    expect(probabilityOf({ id: "1", odds: "1.22", probability: "0E-10" })).toBeNull();
    expect(probabilityOf({ id: "1", odds: "1.22", probability: "" })).toBeNull();
    expect(probabilityOf({ id: "1", odds: "1.22", probability: "1.4" })).toBeNull();
  });
});
