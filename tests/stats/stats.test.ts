import { describe, expect, it } from "vitest";
import { toMatchSummary } from "@/lib/stats/api-football";
import { buildTeamForm } from "@/lib/stats/form";
import { matchInsights } from "@/lib/stats/insights";
import type { MatchSummary } from "@/lib/stats/types";

const apiFixture = (id: number, home: [number, string], away: [number, string], goals: [number | null, number | null], short = "FT", date = "2026-09-20T14:00:00+00:00") => ({
  fixture: { id, date, status: { short, long: short === "FT" ? "Match Finished" : "Not Started", elapsed: short === "FT" ? 90 : null } },
  league: { id: 39, name: "Premier League", country: "England", logo: null, season: 2026 },
  teams: { home: { id: home[0], name: home[1], logo: null }, away: { id: away[0], name: away[1], logo: null } },
  goals: { home: goals[0], away: goals[1] },
});

describe("API-Football mapping", () => {
  it("maps fixtures and statuses", () => {
    const m = toMatchSummary(apiFixture(1, [33, "Manchester United"], [47, "Tottenham"], [2, 1]));
    expect(m).toMatchObject({ id: 1, status: "FINISHED", home: { id: 33 }, goals: { home: 2, away: 1 }, kickoffAt: "2026-09-20T14:00:00.000Z" });
    expect(toMatchSummary(apiFixture(2, [1, "A"], [2, "B"], [null, null], "NS")).status).toBe("SCHEDULED");
    expect(toMatchSummary({ ...apiFixture(3, [1, "A"], [2, "B"], [1, 0], "2H"), fixture: { id: 3, date: "2026-09-20T14:00:00Z", status: { short: "2H", long: "Second Half", elapsed: 67 } } }).statusLabel).toBe("67'");
  });
});

describe("form + insights", () => {
  const team = { id: 33, name: "Man Utd", logo: null };
  const games: MatchSummary[] = [
    toMatchSummary(apiFixture(1, [33, "Man Utd"], [2, "B"], [3, 1], "FT", "2026-09-27T14:00:00Z")),
    toMatchSummary(apiFixture(2, [3, "C"], [33, "Man Utd"], [2, 2], "FT", "2026-09-20T14:00:00Z")),
    toMatchSummary(apiFixture(3, [33, "Man Utd"], [4, "D"], [0, 1], "FT", "2026-09-13T14:00:00Z")),
    toMatchSummary(apiFixture(4, [5, "E"], [33, "Man Utd"], [1, 2], "FT", "2026-09-06T14:00:00Z")),
    toMatchSummary(apiFixture(5, [33, "Man Utd"], [6, "F"], [null, null], "NS", "2026-10-04T14:00:00Z")),
  ];

  it("computes results from the team's perspective, finished games only, newest first", () => {
    const f = buildTeamForm(team, games);
    expect(f.matches.map((m) => m.result)).toEqual(["W", "D", "L", "W"]);
    expect(f.summary).toMatchObject({ played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 7, goalsAgainst: 5, bttsRate: 0.75, over25Rate: 0.75 });
  });

  it("describes stats without predicting", () => {
    const form = buildTeamForm(team, games);
    const other = buildTeamForm({ id: 2, name: "B", logo: null }, []);
    const lines = matchInsights({ match: games[4], form: { home: form, away: other }, h2h: [], standings: null, unavailable: [], events: [], coverage: null, busy: false, source: "sample" });
    expect(lines[0]).toBe("Man Utd: 2W 1D 1L in the last 4, scoring 7 and conceding 5.");
    expect(lines.join(" ")).not.toMatch(/will|predict|likely/i);
  });
});
