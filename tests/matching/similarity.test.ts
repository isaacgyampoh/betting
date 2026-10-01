import { describe, expect, it } from "vitest";
import { createBetwayAdapter } from "@/lib/bookmakers/betway";
import { createSportyBetAdapter } from "@/lib/bookmakers/sportybet";
import { sameMarket } from "@/lib/markets/types";
import { bestMatch, buildAliasIndex, jaroWinkler, MATCH_THRESHOLD, teamSimilarity, levelFromCompetition, withSquadLevel } from "@/lib/matching/similarity";

describe("teamSimilarity", () => {
  it.each([
    ["Manchester United", "Man Utd"],
    ["Tottenham", "Tottenham Hotspur"],
    ["Wolverhampton", "Wolves"],
    ["Brighton & Hove Albion", "Brighton"],
    ["Inter Milano", "Inter"],
    ["AC Milan", "Milan"],
    ["SSC Napoli", "Napoli"],
    ["Asante Kotoko", "Kotoko"],
    ["Hearts of Oak", "Accra Hearts of Oak"],
    ["Athletic Bilbao", "Athletic Club"],
    ["Atlético Madrid", "Atl. Madrid"],
    ["Medeama SC", "Medeama"],
    ["Sheffield Utd", "Sheffield United"],
  ])("%s ≈ %s", (a, b) => {
    expect(teamSimilarity(a, b)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it.each([
    ["Manchester United", "Manchester City"],
    ["Inter", "AC Milan"],
    ["Real Madrid", "Real Betis"],
    ["Hearts of Oak", "Asante Kotoko"],
    ["Arsenal", "Aston Villa"],
  ])("%s ≠ %s", (a, b) => {
    expect(teamSimilarity(a, b)).toBeLessThan(MATCH_THRESHOLD);
  });

  it("uses learned DB aliases", () => {
    const index = buildAliasIndex([{ alias: "Legon Cities FC", canonical: "Legon Cities" }, { alias: "LCFC", canonical: "Legon Cities" }]);
    expect(teamSimilarity("LCFC", "Legon Cities", index)).toBeGreaterThanOrEqual(0.98);
  });

  it("jaroWinkler basics", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("abc", "")).toBe(0);
  });
});

describe("bestMatch", () => {
  const kickoff = new Date("2026-10-03T14:00:00Z");
  const candidates = [
    { home: "Man City", away: "Arsenal", kickoffAt: kickoff },
    { home: "Man Utd", away: "Tottenham Hotspur", kickoffAt: kickoff },
    { home: "Man Utd", away: "Tottenham Hotspur", kickoffAt: new Date(kickoff.getTime() + 24 * 3600_000) },
  ];

  it("requires both teams and the kickoff window", () => {
    expect(bestMatch({ home: "Manchester United", away: "Tottenham", kickoffAt: kickoff }, candidates)?.candidate).toBe(candidates[1]);
    expect(bestMatch({ home: "Manchester United", away: "Tottenham", kickoffAt: new Date(kickoff.getTime() + 16 * 60_000) }, candidates)).toBeNull();
    expect(bestMatch({ home: "Manchester United", away: "Chelsea", kickoffAt: kickoff }, candidates)).toBeNull();
  });
});

describe("SportyBet → Betway matching over the mocks", () => {
  const sporty = createSportyBetAdapter("mock", { latencyMs: 0 });
  const betway = createBetwayAdapter("mock", { latencyMs: 0 });

  it("matches every game listed on both, and reports the one that isn't", async () => {
    const slip = await sporty.loadCode("BC7K2Q");
    const outcomes: string[] = [];
    for (const s of slip.selections) {
      const found = await betway.searchEvent(s.event.home, s.event.away, s.event.kickoffAt);
      const match = bestMatch(s.event, found);
      if (!match) {
        outcomes.push(`${s.event.home}: not found`);
        continue;
      }
      const { offers } = await betway.getEventMarkets(match.candidate.externalId);
      const offer = offers.find((o) => o.market && sameMarket(o.market, s.market!));
      outcomes.push(`${s.event.home} → ${match.candidate.home}: ${offer ? "ok" : "market missing"}`);
    }
    expect(outcomes).toEqual([
      "Manchester United → Man Utd: ok",
      "Arsenal → Arsenal: ok",
      "Wolverhampton → Wolves: ok",
      "Brighton → Brighton & Hove Albion: ok",
      "Atletico Madrid → Atl. Madrid: ok",
      "Inter Milano → Inter: ok",
      "Asante Kotoko → Kotoko: ok",
      "Nations FC: not found",
    ]);
  });

  it("books the converted picks on Betway", async () => {
    const slip = await sporty.loadCode("BC7K2Q");
    const first = slip.selections[0];
    const match = bestMatch(first.event, await betway.searchEvent(first.event.home, first.event.away, first.event.kickoffAt))!;
    const created = await betway.createCode([{ eventExternalId: match.candidate.externalId, market: first.market! }]);
    const reloaded = await betway.loadCode(created.code);
    expect(reloaded.selections[0].event.home).toBe("Man Utd");
    expect(reloaded.selections[0].market).toEqual(first.market);
  });
});

describe("typo tolerance", () => {
  it.each([
    ["Tottenhm Hotspur", "Tottenham Hotspur"],
    ["Asante Kotokoo", "Asante Kotoko"],
    ["Juventus", "Juventus FC"],
  ])("%s ≈ %s", (a, b) => expect(teamSimilarity(a, b)).toBeGreaterThanOrEqual(MATCH_THRESHOLD));

  it.each([
    ["Real Madrid", "Real Sociedad"],
    ["Aston Villa", "Villarreal"],
    ["Inter Milan", "AC Milan"],
  ])("%s ≠ %s", (a, b) => expect(teamSimilarity(a, b)).toBeLessThan(MATCH_THRESHOLD));
});

// A senior side and its age-group team share a name, and the shorter name is wholly contained in
// the longer one, so they used to score as a near-certain match. That put one squad's results under
// another squad's game: a published pick cited "North Macedonia U21's games" for a senior fixture.
describe("squad levels are different teams", () => {
  it.each([
    ["North Macedonia", "North Macedonia U21"],
    ["Montenegro", "Montenegro U21"],
    ["Brazil", "Brazil U23"],
    ["Arsenal", "Arsenal W"],
    ["Real Madrid", "Real Madrid B"],
    ["Chelsea", "Chelsea Reserves"],
  ])("%s never matches %s", (senior, other) => {
    expect(teamSimilarity(senior, other)).toBe(0);
    expect(teamSimilarity(other, senior)).toBe(0);
  });

  it("still matches two names for the same squad", () => {
    expect(teamSimilarity("Brazil U23", "Brasil U23")).toBeGreaterThan(0.8);
    // Feeds disagree on how to mark a women's side; they are the same team.
    expect(teamSimilarity("Arsenal W", "Arsenal Women")).toBe(1);
    expect(teamSimilarity("Hacken Gothenburg W", "Hacken Gothenburg Ladies")).toBe(1);
  });

  it("the level check never lowers an ordinary score", () => {
    // "N." vs "North" is an abbreviation limit that predates this and is unaffected by it.
    expect(teamSimilarity("North Macedonia U21", "N. Macedonia U21")).toBeGreaterThanOrEqual(
      teamSimilarity("North Macedonia", "N. Macedonia"),
    );
  });

  it("leaves ordinary senior matching alone", () => {
    expect(teamSimilarity("Newcastle", "Newcastle United")).toBeGreaterThan(0.8);
    expect(teamSimilarity("Man Utd", "Manchester United")).toBeGreaterThan(0.8);
  });
});

// Some feeds mark an age group or a women's side only in the competition name. A published pick for
// "North Macedonia v Montenegro" in the "U21 UEFA European Championship" had no history at all,
// because the stats provider calls those teams "North Macedonia U21".
describe("squad level taken from the competition", () => {
  it("reads a level out of a competition name", () => {
    expect(levelFromCompetition("U21 UEFA European Championship, Qualification")).toBe("u21");
    expect(levelFromCompetition("UEFA Women's Champions League")).toBe("w");
    expect(levelFromCompetition("UEFA Nations League")).toBeNull();
    expect(levelFromCompetition(null)).toBeNull();
  });

  it("adds the marker only when the team name lacks one", () => {
    expect(withSquadLevel("Montenegro", "u21")).toBe("Montenegro u21");
    expect(withSquadLevel("Montenegro U21", "u21")).toBe("Montenegro U21");
    expect(withSquadLevel("Montenegro", null)).toBe("Montenegro");
  });

  it("makes the competition-marked fixture match its own squad again", () => {
    const level = levelFromCompetition("U21 UEFA European Championship");
    expect(teamSimilarity(withSquadLevel("Montenegro", level), "Montenegro U21")).toBeGreaterThan(0.8);
    // And still refuses the senior side.
    expect(teamSimilarity(withSquadLevel("Montenegro", level), "Montenegro")).toBe(0);
  });
});
