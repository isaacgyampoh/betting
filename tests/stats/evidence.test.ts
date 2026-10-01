import { describe, expect, it } from "vitest";
import { evidenceFor } from "@/lib/stats/evidence";
import type { MatchDetail, MatchSummary, TeamForm, TeamRef } from "@/lib/stats/types";

// The counts in these sentences are what a user checks us on, so they are pinned exactly.

const team = (id: number, name: string): TeamRef => ({ id, name, logo: null });
const HOME = team(1, "Shimizu");
const AWAY = team(2, "Yokohama");

const summary = (hg: number | null, ag: number | null, home = HOME, away = AWAY): MatchSummary => ({
  id: Math.random(),
  kickoffAt: new Date().toISOString(),
  status: "FINISHED",
  statusLabel: "FT",
  league: { id: 1, name: "J1", country: "Japan", season: 2026, logo: null },
  home,
  away,
  goals: { home: hg, away: ag },
});

/** `games` as [homeGoals, awayGoals, wasHome] from the listed team's perspective. */
function form(t: TeamRef, games: [number, number, boolean][]): TeamForm {
  const matches = games.map(([gf, ga, wasHome]) => ({
    match: wasHome ? summary(gf, ga, t, team(99, "Other")) : summary(ga, gf, team(99, "Other"), t),
    result: (gf > ga ? "W" : gf === ga ? "D" : "L") as "W" | "D" | "L",
    goalsFor: gf,
    goalsAgainst: ga,
    wasHome,
  }));
  const s = {
    played: matches.length,
    won: matches.filter((m) => m.result === "W").length,
    drawn: matches.filter((m) => m.result === "D").length,
    lost: matches.filter((m) => m.result === "L").length,
    goalsFor: matches.reduce((a, m) => a + m.goalsFor, 0),
    goalsAgainst: matches.reduce((a, m) => a + m.goalsAgainst, 0),
    bttsRate: matches.filter((m) => m.goalsFor > 0 && m.goalsAgainst > 0).length / (matches.length || 1),
    over25Rate: matches.filter((m) => m.goalsFor + m.goalsAgainst > 2.5).length / (matches.length || 1),
  };
  return { team: t, matches, summary: s };
}

const detail = (home: TeamForm, away: TeamForm, h2h: MatchSummary[] = []): MatchDetail => ({
  match: summary(null, null),
  form: { home, away },
  h2h,
  standings: null,
  unavailable: [],
  busy: false,
  source: "api-football",
});

const over = (line: number) => ({ marketId: "18", outcome: "OVER", line, type: "OVER_UNDER" });
const under = (line: number) => ({ marketId: "18", outcome: "UNDER", line, type: "OVER_UNDER" });

describe("totals evidence", () => {
  const scoring: [number, number, boolean][] = [
    [2, 1, true], [3, 0, false], [1, 1, true], [2, 2, false], [0, 2, true],
  ]; // all 5 over 1.5
  const dull: [number, number, boolean][] = [
    [1, 0, true], [0, 0, false], [1, 0, true], [0, 1, false], [2, 0, true],
  ]; // 1 of 5 over 1.5

  it("counts how many of each side's games cleared the line", () => {
    const e = evidenceFor(over(1.5), detail(form(HOME, scoring), form(AWAY, dull)))!;
    expect(e.text).toBe("Shimizu's games went over 1.5 in 5 of 5, Yokohama's in 1 of 5.");
    expect(e.support).toBeCloseTo((1 + 0.2) / 2);
    expect(e.sample).toBe(10);
  });

  it("inverts the count for an under pick", () => {
    const e = evidenceFor(under(1.5), detail(form(HOME, scoring), form(AWAY, dull)))!;
    expect(e.text).toBe("Shimizu's games stayed under 1.5 in 0 of 5, Yokohama's in 4 of 5.");
    expect(e.support).toBeCloseTo((0 + 0.8) / 2);
  });

  it("adds head-to-head only when there are at least three meetings", () => {
    const two = [summary(2, 1), summary(3, 0)];
    expect(evidenceFor(over(1.5), detail(form(HOME, scoring), form(AWAY, scoring), two))!.text).not.toContain("meetings");

    const three = [summary(2, 1), summary(3, 0), summary(0, 0)];
    const e = evidenceFor(over(1.5), detail(form(HOME, scoring), form(AWAY, scoring), three))!;
    expect(e.text).toContain("and 2 of 3 of their meetings did too");
    expect(e.sample).toBe(13);
  });

  it("ignores fixtures that haven't been played", () => {
    const withUnplayed = [summary(2, 1), summary(null, null), summary(3, 1), summary(0, 0)];
    const e = evidenceFor(over(1.5), detail(form(HOME, scoring), form(AWAY, scoring), withUnplayed))!;
    expect(e.text).toContain("2 of 3 of their meetings");
  });

  it("returns nothing when a side has no history, rather than claiming 0 of 0", () => {
    expect(evidenceFor(over(1.5), detail(form(HOME, scoring), form(AWAY, [])))).toBeNull();
    expect(evidenceFor({ marketId: "18", outcome: "OVER", line: null }, detail(form(HOME, scoring), form(AWAY, scoring)))).toBeNull();
  });
});

describe("result evidence", () => {
  // Shimizu at home: W W D W L  -> unbeaten 4 of 5, won 3 of 5
  const homeForm = form(HOME, [[2, 0, true], [1, 0, true], [1, 1, true], [3, 1, true], [0, 1, true]]);
  // Yokohama away: W L L D L -> won 1 of 5
  const awayForm = form(AWAY, [[2, 1, false], [0, 1, false], [0, 2, false], [1, 1, false], [0, 3, false]]);

  it("uses unbeaten for a double chance and wins for a straight result", () => {
    const dc = evidenceFor({ marketId: "10", outcome: "HOME_DRAW", line: null }, detail(homeForm, awayForm))!;
    expect(dc.text).toBe("Shimizu avoided defeat in 4 of 5 at home, while Yokohama won just 1 of 5 away.");

    const win = evidenceFor({ marketId: "1", outcome: "HOME", line: null }, detail(homeForm, awayForm))!;
    expect(win.text).toBe("Shimizu won in 3 of 5 at home, while Yokohama won just 1 of 5 away.");
  });

  it("counts only home games for the home side and away games for the away side", () => {
    // Give the home team a strong away record that must not be counted.
    const mixed = form(HOME, [[0, 2, true], [5, 0, false], [5, 0, false], [5, 0, false]]);
    const e = evidenceFor({ marketId: "1", outcome: "HOME", line: null }, detail(mixed, awayForm))!;
    expect(e.text).toContain("Shimizu won in 0 of 1 at home");
  });

  it("won't let a weak opponent rescue a side with a poor record of its own", () => {
    // Malta avoided defeat in 1 of 5 at home; Gibraltar won 0 of 3 away. Published, this read as an
    // argument against the very pick it was attached to.
    const weakHome = form(HOME, [[0, 1, true], [0, 2, true], [1, 1, true], [0, 3, true], [1, 2, true]]);
    const weakerAway = form(AWAY, [[0, 2, false], [0, 1, false], [1, 3, false]]);
    const e = evidenceFor({ marketId: "10", outcome: "HOME_DRAW", line: null }, detail(weakHome, weakerAway))!;
    expect(e.support).toBeLessThan(0.4); // below the veto line
  });

  it("backs the away side when the pick does", () => {
    const e = evidenceFor({ marketId: "1", outcome: "AWAY", line: null }, detail(homeForm, awayForm))!;
    expect(e.text).toBe("Yokohama won in 1 of 5 away, while Shimizu won just 3 of 5 at home.");
  });

  it("says nothing about a draw-only pick", () => {
    expect(evidenceFor({ marketId: "1", outcome: "DRAW", line: null }, detail(homeForm, awayForm))).toBeNull();
    expect(evidenceFor({ marketId: "10", outcome: "HOME_AWAY", line: null }, detail(homeForm, awayForm))).toBeNull();
  });
});

describe("both teams to score evidence", () => {
  const bothScore = form(HOME, [[2, 1, true], [1, 1, false], [3, 2, true], [0, 1, false]]); // 3 of 4
  const cleanSheets = form(AWAY, [[1, 0, true], [0, 0, false], [2, 0, true], [1, 1, false]]); // 1 of 4

  it("counts games where both sides scored", () => {
    const e = evidenceFor({ marketId: "29", outcome: "YES", line: null }, detail(bothScore, cleanSheets))!;
    expect(e.text).toBe("Shimizu's games saw both teams score in 3 of 4, Yokohama's in 1 of 4.");
    expect(e.support).toBeCloseTo((0.75 + 0.25) / 2);
  });

  it("inverts for the no pick", () => {
    const e = evidenceFor({ marketId: "29", outcome: "NO", line: null }, detail(bothScore, cleanSheets))!;
    expect(e.text).toBe("Shimizu's games had at least one side fail to score in 1 of 4, Yokohama's in 3 of 4.");
  });
});

describe("markets we hold no history for", () => {
  const f = form(HOME, [[2, 1, true]]);
  it.each([["166", "corners"], ["139", "cards"], ["900342", "fouls"], ["68", "first half"], ["19", "team totals"]])(
    "returns null for market %s (%s) rather than inventing support",
    (marketId) => {
      expect(evidenceFor({ marketId, outcome: "OVER", line: 2.5 }, detail(f, f))).toBeNull();
    },
  );
});
