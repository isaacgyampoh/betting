import { describe, expect, it } from "vitest";
import { draftsFromRoute, eventNameMatches, statusForReason } from "@/lib/services/convert-via-route";
import type { RouteResult } from "@/lib/bookmakers/providers/types";
import type { SlipRecord } from "@/lib/services/slips";

// A provider describes legs in its own words. These pin the rule that the fixture identity always
// comes from our own slip and never from the provider's string.

const KICKOFF = new Date("2026-10-24T17:30:00.000Z");

function sel(position: number, homeTeam: string, awayTeam: string) {
  return { position, homeTeam, awayTeam, kickoffAt: KICKOFF, competition: "Premier League", status: "OK" };
}

function slip(selections: ReturnType<typeof sel>[]): SlipRecord {
  return {
    bookmaker: { id: "b1", slug: "sportybet", name: "SportyBet", country: "GH" },
    bookingCode: "ABC123",
    selections,
  } as unknown as SlipRecord;
}

const result = (over: Partial<RouteResult> = {}): RouteResult => ({
  targetCode: "XYZ789",
  expiresAt: null,
  matched: [],
  unmatched: [],
  sourceOddsTotal: null,
  targetOddsTotal: null,
  routeId: "betloy",
  ...over,
});

describe("eventNameMatches", () => {
  it("matches an abbreviated name", () => {
    expect(eventNameMatches("Manchester United", "Chelsea", "Man United vs Chelsea")).toBe(true);
  });
  it("ignores accents and punctuation", () => {
    expect(eventNameMatches("Atlético Madrid", "Real Betis", "Atletico Madrid - Real Betis")).toBe(true);
  });
  it("refuses a fixture sharing only one side", () => {
    expect(eventNameMatches("Arsenal", "Chelsea", "Arsenal vs Tottenham")).toBe(false);
  });
  it("handles short names with no long token", () => {
    expect(eventNameMatches("Roma", "Lyon", "Roma v Lyon")).toBe(true);
    expect(eventNameMatches("Roma", "Lyon", "Roma v Nice")).toBe(false);
  });
});

describe("statusForReason", () => {
  it("reads the provider's wording", () => {
    expect(statusForReason("EVENT_STARTED", "This game has already kicked off")).toBe("EVENT_STARTED");
    expect(statusForReason("NO_MARKET", "market not offered")).toBe("MARKET_NOT_FOUND");
    expect(statusForReason("NOT_FOUND", "fixture not listed")).toBe("EVENT_NOT_FOUND");
    expect(statusForReason("WEIRD", "something else entirely")).toBe("UNSUPPORTED_MARKET");
  });
});

describe("draftsFromRoute", () => {
  it("keeps our fixture identity and takes the destination's price", () => {
    const source = slip([sel(1, "Arsenal", "Chelsea")]);
    const drafts = draftsFromRoute(
      source,
      result({
        matched: [
          {
            eventName: "Arsenal vs Chelsea",
            competition: "EPL",
            market: "Over/Under",
            selection: "Over 2.5",
            line: "2.5",
            startDate: "2099-01-01T00:00:00.000Z",
            sourceOdds: 1.8,
            targetOdds: 1.95,
            lineAdjusted: false,
          },
        ],
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("OK");
    expect(drafts[0].odds).toBe(1.95);
    // The provider's startDate is years out; ours is the one that survives.
    expect(drafts[0].event.kickoffAt).toEqual(KICKOFF);
    expect(drafts[0].event.home).toBe("Arsenal");
    expect(drafts[0].event.competition).toBe("Premier League");
    // No fabricated booking ids: a provider never gives us the destination's own ids.
    expect(drafts[0].raw?.marketId).toBe("");
    expect(drafts[0].raw?.marketName).toBe("Over/Under");
    expect(drafts[0].market).toBeNull();
  });

  it("reports a leg the provider never mentioned rather than dropping it", () => {
    const source = slip([sel(1, "Arsenal", "Chelsea"), sel(2, "Everton", "Fulham")]);
    const drafts = draftsFromRoute(
      source,
      result({
        matched: [
          {
            eventName: "Arsenal v Chelsea",
            competition: null,
            market: "1X2",
            selection: "Home",
            line: null,
            startDate: null,
            sourceOdds: 2.0,
            targetOdds: 2.1,
            lineAdjusted: false,
          },
        ],
      }),
    );

    expect(drafts).toHaveLength(2);
    expect(drafts[0].status).toBe("OK");
    expect(drafts[1].status).toBe("EVENT_NOT_FOUND");
    expect(drafts[1].event.home).toBe("Everton");
    expect(drafts[1].reason).toContain("betloy");
  });

  it("carries an unmatched leg's own reason through", () => {
    const source = slip([sel(1, "Everton", "Fulham")]);
    const drafts = draftsFromRoute(
      source,
      result({
        unmatched: [
          { eventName: "Everton vs Fulham", market: "BTTS", selection: "Yes", reason: "NO_MARKET", reasonText: "market not offered there" },
        ],
      }),
    );
    expect(drafts[0].status).toBe("MARKET_NOT_FOUND");
    expect(drafts[0].reason).toBe("market not offered there");
    expect(drafts[0].odds).toBeNull();
  });

  it("flags a line the destination priced differently", () => {
    const source = slip([sel(1, "Arsenal", "Chelsea")]);
    const drafts = draftsFromRoute(
      source,
      result({
        matched: [
          {
            eventName: "Arsenal vs Chelsea",
            competition: null,
            market: "Over/Under",
            selection: "Over",
            line: "3.0",
            startDate: null,
            sourceOdds: 2.0,
            targetOdds: 2.2,
            lineAdjusted: true,
          },
        ],
      }),
    );
    expect(drafts[0].status).toBe("OK");
    expect(drafts[0].reason).toContain("3.0");
  });

  it("preserves the source order and positions", () => {
    const source = slip([sel(1, "Arsenal", "Chelsea"), sel(2, "Everton", "Fulham"), sel(3, "Leeds", "Burnley")]);
    const drafts = draftsFromRoute(source, result());
    expect(drafts.map((d) => d.position)).toEqual([1, 2, 3]);
    expect(drafts.map((d) => d.event.home)).toEqual(["Arsenal", "Everton", "Leeds"]);
  });
});
