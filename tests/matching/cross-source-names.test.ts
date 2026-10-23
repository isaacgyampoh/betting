import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD, teamSimilarity } from "@/lib/matching/similarity";

/**
 * Where cross-source fixture matching currently fails, pinned deliberately.
 *
 * Two directions exist in the product and only one of them needs this. Claw starts from a
 * bookmaker's own fixture list, so it never compares names across sources and never hits this.
 * The match analyst starts from API-Football - the fixture the user tapped - and has to find that
 * same game at a bookmaker, which means comparing one source's club names with another's.
 *
 * Observed on 23 October 2026: SportyBet carried both fixtures below and priced them (Claw quoted
 * Stuttgart at 1.39 and Brest v Nice BTTS at 1.61 from SportyBet in the same session), while
 * `get_match_markets` reported them "not listed at SportyBet". The bookmaker was never the
 * problem; the name comparison was.
 *
 * These assert the gap rather than hide it. The threshold is NOT lowered to make them pass: the
 * same comparison decides which fixture a slip converts to, and a false match there books a bet on
 * the wrong game. Closing this needs aliases or a matcher that understands abbreviation, with its
 * own evidence - not a looser number.
 */
describe("club names that differ between the stats provider and the bookmaker", () => {
  it("matches when one name merely adds a word", () => {
    expect(teamSimilarity("Ipswich", "Ipswich Town")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(teamSimilarity("VfB Stuttgart", "Stuttgart")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("KNOWN GAP: an abbreviated club name does not match", () => {
    // "Borussia M´gladbach" is how SportyBet writes Borussia Mönchengladbach.
    const score = teamSimilarity("Borussia Mönchengladbach", "Borussia M´gladbach");
    expect(score).toBeLessThan(MATCH_THRESHOLD);
    // Pinned so a matcher change shows up here as a deliberate improvement, not a silent one.
    expect(score).toBeCloseTo(0.417, 2);
  });

  it("KNOWN GAP: a short form of a longer club name does not match", () => {
    // API-Football says "Stade Brestois 29"; SportyBet says "Brest".
    const score = teamSimilarity("Stade Brestois 29", "Brest");
    expect(score).toBeLessThan(MATCH_THRESHOLD);
    expect(score).toBeCloseTo(0.617, 2);
  });

  it("one failing side is enough to lose the fixture, because the score is the minimum", () => {
    // Nice matches perfectly; Brest does not. bestMatch takes min(home, away), so the pair fails.
    const home = teamSimilarity("Stade Brestois 29", "Brest");
    const away = teamSimilarity("Nice", "Nice");
    expect(away).toBe(1);
    expect(Math.min(home, away)).toBeLessThan(MATCH_THRESHOLD);
  });
});
