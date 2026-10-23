import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD, teamSimilarity } from "@/lib/matching/similarity";

/**
 * Cross-source fixture matching, and the gap that used to be here.
 *
 * Two directions exist and only one needs this. Claw starts from a bookmaker's own fixture list,
 * so it never compares names across sources. The match analyst starts from the fixture the user
 * tapped - an API-Football record - and has to find that same game at a bookmaker.
 *
 * On 23 October 2026 that failed for two fixtures SportyBet was actually carrying: it priced
 * Stuttgart at 1.39 and Brest v Nice both teams to score at 1.61 while the analyst reported both
 * "not listed". The scores were 0.417 and 0.617 against a 0.8 threshold, and `bestMatch` takes the
 * minimum of the two sides, so one abbreviated name lost the whole fixture.
 *
 * It was fixed with aliases read from the providers' own records rather than by lowering the
 * threshold - the same comparison decides which fixture a slip converts to, and a false match
 * there books a bet on the wrong game. These assert the fix and, just as importantly, that the
 * aliases did not drag anything else in with them.
 */
describe("club names that differ between the stats provider and the bookmaker", () => {
  it("matches when one name merely adds or drops a word", () => {
    expect(teamSimilarity("Ipswich", "Ipswich Town")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(teamSimilarity("VfB Stuttgart", "Stuttgart")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(teamSimilarity("Malaga", "Malaga CF")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("matches the abbreviation SportyBet writes, which used to score 0.417", () => {
    expect(teamSimilarity("Borussia Mönchengladbach", "Borussia M´gladbach")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("matches the short form both bookmakers write, which used to score 0.617", () => {
    expect(teamSimilarity("Stade Brestois 29", "Brest")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("still refuses two different clubs that share a word", () => {
    expect(teamSimilarity("Borussia Mönchengladbach", "Borussia Dortmund")).toBeLessThan(MATCH_THRESHOLD);
    expect(teamSimilarity("Stade Brestois 29", "Dynamo Brest")).toBeLessThan(MATCH_THRESHOLD);
    expect(teamSimilarity("Inter", "Milan")).toBeLessThan(MATCH_THRESHOLD);
  });

  it("still refuses a senior side and its youth team", () => {
    expect(teamSimilarity("Ipswich Town", "Ipswich Town U21")).toBeLessThan(MATCH_THRESHOLD);
  });
});
