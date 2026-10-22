import { describe, expect, it } from "vitest";
import { buildTeamForm } from "@/lib/stats/form";
import type { MatchSummary, TeamRef } from "@/lib/stats/types";

// A side that is strong at home and poor away is the case these splits exist to expose: the
// overall figures for such a team are indistinguishable from a side that is mediocre everywhere,
// and that difference decides most 1X2 and over/under leans.

const team = (id: number, name: string): TeamRef => ({ id, name, logo: null });
const US = team(1, "Hearts of Oak");
const THEM = team(2, "Kotoko");

let seq = 0;
/** One finished game, from our team's perspective. */
const game = (ourGoals: number, theirGoals: number, atHome: boolean): MatchSummary => ({
  id: ++seq,
  // Descending kick-offs so ordering is deterministic rather than clock-dependent.
  kickoffAt: new Date(Date.UTC(2026, 0, 100 - seq)).toISOString(),
  status: "FINISHED",
  statusLabel: "FT",
  league: { id: 1, name: "Premier League", country: "Ghana", season: 2026, logo: null },
  home: atHome ? US : THEM,
  away: atHome ? THEM : US,
  goals: atHome ? { home: ourGoals, away: theirGoals } : { home: theirGoals, away: ourGoals },
});

describe("buildTeamForm splits", () => {
  it("separates home and away records from the same window", () => {
    const form = buildTeamForm(US, [
      game(3, 0, true),
      game(2, 1, true),
      game(1, 0, true),
      game(0, 2, false),
      game(1, 3, false),
    ]);

    expect(form.summary.played).toBe(5);
    expect(form.summary.won).toBe(3);
    expect(form.summary.lost).toBe(2);

    expect(form.splits.home.played).toBe(3);
    expect(form.splits.home.won).toBe(3);
    expect(form.splits.home.lost).toBe(0);
    expect(form.splits.home.goalsFor).toBe(6);

    expect(form.splits.away.played).toBe(2);
    expect(form.splits.away.won).toBe(0);
    expect(form.splits.away.lost).toBe(2);
    expect(form.splits.away.goalsAgainst).toBe(5);
  });

  it("adds back up to the overall summary", () => {
    const form = buildTeamForm(US, [game(2, 2, true), game(0, 1, false), game(4, 1, true), game(1, 1, false)]);
    const { home, away } = form.splits;
    for (const k of ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst"] as const) {
      expect(home[k] + away[k]).toBe(form.summary[k]);
    }
  });

  it("reports an empty half rather than a rate over zero games", () => {
    const form = buildTeamForm(US, [game(1, 0, true), game(2, 0, true)]);
    expect(form.splits.away.played).toBe(0);
    // Not NaN: a rate with no games behind it is zero, and the played count says why.
    expect(form.splits.away.over25Rate).toBe(0);
    expect(form.splits.away.bttsRate).toBe(0);
    expect(form.splits.home.played).toBe(2);
  });

  it("ignores unfinished games in both the summary and the splits", () => {
    const scheduled = { ...game(0, 0, true), status: "SCHEDULED" as const, goals: { home: null, away: null } };
    const form = buildTeamForm(US, [game(1, 0, true), scheduled, game(0, 3, false)]);
    expect(form.summary.played).toBe(2);
    expect(form.splits.home.played).toBe(1);
    expect(form.splits.away.played).toBe(1);
  });
});
