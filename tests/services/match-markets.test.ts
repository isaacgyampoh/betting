import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD, bestMatch, teamSimilarity } from "@/lib/matching/similarity";

/**
 * The fixture identity behind a quote.
 *
 * A price is only as trustworthy as the match that found it, and quoting the wrong fixture's
 * prices is the one failure that would be invisible: the answer reads perfectly and describes
 * another game. These pin the aliases added from the providers' own records on 23 Oct 2026, and -
 * more importantly - the cases that must keep failing.
 */

const KICKOFF = new Date("2026-10-23T18:45:00.000Z");
const candidate = (home: string, away: string, mins = 0) => ({
  home,
  away,
  externalId: "evt-1",
  competition: "Ligue 1",
  kickoffAt: new Date(KICKOFF.getTime() + mins * 60_000),
});

describe("aliases taken from the providers' own records", () => {
  it("matches the spellings each provider actually uses", () => {
    // API-Football / SportyBet / Football.com, read from their live fixture lists.
    expect(teamSimilarity("Borussia Mönchengladbach", "Borussia M´gladbach")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(teamSimilarity("Borussia Mönchengladbach", "Borussia Monchengladbach")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(teamSimilarity("Stade Brestois 29", "Brest")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(teamSimilarity("VfB Stuttgart", "Stuttgart")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("does not drag a different club in with them", () => {
    // Dynamo Brest normalises to "dynamo brest" and must not land in the Brestois group.
    expect(teamSimilarity("Stade Brestois 29", "Dynamo Brest")).toBeLessThan(MATCH_THRESHOLD);
    expect(teamSimilarity("Borussia Mönchengladbach", "Borussia Dortmund")).toBeLessThan(MATCH_THRESHOLD);
    expect(teamSimilarity("Nice", "Brest")).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe("the fixture a quote is allowed to come from", () => {
  const source = { home: "Stade Brestois 29", away: "Nice", kickoffAt: KICKOFF };

  it("accepts the same fixture under the bookmaker's own names", () => {
    expect(bestMatch(source, [candidate("Brest", "Nice")])).not.toBeNull();
  });

  it("rejects the same two clubs with the sides reversed", () => {
    // A reversed fixture is a different bet on every market that names a side.
    expect(bestMatch(source, [candidate("Nice", "Brest")])).toBeNull();
  });

  it("rejects a different fixture in the same competition", () => {
    expect(bestMatch(source, [candidate("Lyon", "Marseille")])).toBeNull();
  });

  it("rejects a fixture sharing only one side", () => {
    expect(bestMatch(source, [candidate("Brest", "Marseille")])).toBeNull();
  });

  it("rejects the same fixture at the wrong kick-off", () => {
    // A stale record of an earlier meeting carries the same names and different prices.
    expect(bestMatch(source, [candidate("Brest", "Nice", 7 * 24 * 60)])).toBeNull();
  });

  it("accepts a small kick-off disagreement between providers", () => {
    expect(bestMatch(source, [candidate("Brest", "Nice", 5)])).not.toBeNull();
  });

  it("picks the better of two plausible candidates", () => {
    const hit = bestMatch(source, [candidate("Brest", "Nice"), candidate("Stade Brestois 29", "Nice")]);
    expect(hit).not.toBeNull();
    // The exact-name candidate scores 1.0 against the alias candidate's 0.98.
    expect(hit!.candidate.home).toBe("Stade Brestois 29");
  });
});
