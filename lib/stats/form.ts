import type { FormResult, FormSummary, MatchSummary, TeamForm, TeamRef } from "@/lib/stats/types";

type FormRow = { match: MatchSummary; result: FormResult; goalsFor: number; goalsAgainst: number; wasHome: boolean };

/** The figures for one set of rows. Used for the whole window and for each side of the split. */
function summarise(rows: FormRow[]): FormSummary {
  const played = rows.length;
  const rate = (n: number) => (played ? Math.round((n / played) * 100) / 100 : 0);
  return {
    played,
    won: rows.filter((r) => r.result === "W").length,
    drawn: rows.filter((r) => r.result === "D").length,
    lost: rows.filter((r) => r.result === "L").length,
    goalsFor: rows.reduce((n, r) => n + r.goalsFor, 0),
    goalsAgainst: rows.reduce((n, r) => n + r.goalsAgainst, 0),
    bttsRate: rate(rows.filter((r) => r.goalsFor > 0 && r.goalsAgainst > 0).length),
    over25Rate: rate(rows.filter((r) => r.goalsFor + r.goalsAgainst > 2.5).length),
  };
}

/** Builds a team's recent form from finished matches (most recent first). */
export function buildTeamForm(team: TeamRef, matches: MatchSummary[]): TeamForm {
  const finished = matches
    .filter((m) => m.status === "FINISHED" && m.goals.home !== null && m.goals.away !== null)
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));

  const rows = finished.map((match) => {
    const wasHome = match.home.id === team.id;
    const goalsFor = (wasHome ? match.goals.home : match.goals.away) ?? 0;
    const goalsAgainst = (wasHome ? match.goals.away : match.goals.home) ?? 0;
    const result: FormResult = goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L";
    return { match, result, goalsFor, goalsAgainst, wasHome };
  });

  return {
    team,
    matches: rows,
    summary: summarise(rows),
    splits: {
      home: summarise(rows.filter((r) => r.wasHome)),
      away: summarise(rows.filter((r) => !r.wasHome)),
    },
  };
}
