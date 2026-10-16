import { describe, expect, it } from "vitest";
import { featuredFixtures, type LeagueGroup } from "@/lib/services/stats";

/**
 * "Featured", not "Big Games", on purpose. The provider publishes no attendance, popularity,
 * derby flag or importance score, so significance is not something this data knows. What it does
 * know is which competition a fixture is in, and the rank those competitions already have - an
 * editorial judgement made openly rather than a measurement we are pretending to have taken.
 */
const match = (id: number, status = "SCHEDULED", kickoff = "2026-10-16T19:00:00Z") =>
  ({
    id,
    kickoffAt: kickoff,
    status,
    statusLabel: status,
    league: { id: 1, name: "x", country: "x", season: 2026, logo: null },
    home: { id: 1, name: `Home ${id}`, logo: null },
    away: { id: 2, name: `Away ${id}`, logo: null },
    goals: { home: null, away: null },
  }) as never;

const group = (country: string, name: string, ...matches: unknown[]): LeagueGroup =>
  ({ league: { id: 1, name, country, season: 2026, logo: null }, matches }) as never;

describe("the fixtures a day leads with", () => {
  it("prefers the highest-ranked competition, not the alphabet", () => {
    const featured = featuredFixtures([
      group("Algeria", "Ligue 1", match(1)),
      group("England", "Premier League", match(2)),
      group("Spain", "La Liga", match(3)),
    ]);

    expect(featured.map((f) => f.match.id)).toEqual([2, 3]);
  });

  it("takes at most one fixture per competition, so one league cannot fill the row", () => {
    const featured = featuredFixtures([
      group("England", "Premier League", match(1), match(2), match(3)),
      group("Spain", "La Liga", match(4)),
    ]);

    expect(featured).toHaveLength(2);
    expect(featured.map((f) => f.match.id)).toEqual([1, 4]);
  });

  it("ignores competitions outside the ranked list entirely", () => {
    expect(featuredFixtures([group("Narnia", "Third Division", match(9))])).toEqual([]);
  });

  // A quiet day with nothing ranked is an honest empty, not a reason to promote a third tier.
  it("returns nothing rather than filling the row with whatever is on", () => {
    expect(featuredFixtures([])).toEqual([]);
  });

  it("would rather lead with a game still to come than a finished one", () => {
    const featured = featuredFixtures([
      group("England", "Premier League", match(1, "FINISHED"), match(2, "SCHEDULED")),
    ]);

    expect(featured[0].match.id).toBe(2);
  });

  it("falls back to a finished game when the competition has nothing else", () => {
    const featured = featuredFixtures([group("England", "Premier League", match(1, "FINISHED"))]);
    expect(featured[0].match.id).toBe(1);
  });

  // "Serie A" is Italy's and Brazil's; "Premier League" belongs to England, Armenia, Egypt and
  // others. The name alone turns two competitions into what looks like one repeated.
  it("names the country as well, because competition names are not unique", () => {
    const featured = featuredFixtures([group("England", "Premier League", match(1))]);
    expect(featured[0].reason).toBe("England · Premier League");
  });

  it("keeps two same-named competitions apart", () => {
    const featured = featuredFixtures([
      group("Italy", "Serie A", match(1)),
      group("Brazil", "Serie A", match(2)),
    ]);
    expect(featured.map((f) => f.reason)).toEqual(["Italy · Serie A", "Brazil · Serie A"]);
  });

  it("honours the cap", () => {
    const featured = featuredFixtures(
      [
        group("World", "UEFA Champions League", match(1)),
        group("England", "Premier League", match(2)),
        group("Spain", "La Liga", match(3)),
        group("Italy", "Serie A", match(4)),
        group("Germany", "Bundesliga", match(5)),
        group("France", "Ligue 1", match(6)),
      ],
      3,
    );

    expect(featured).toHaveLength(3);
    expect(featured.map((f) => f.reason)).toEqual([
      "World · UEFA Champions League",
      "England · Premier League",
      "Spain · La Liga",
    ]);
  });
});
