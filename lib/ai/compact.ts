import type { MatchDetail, MatchSummary } from "@/lib/stats/types";
import type { SlipView } from "@/lib/slips/view";
import { matchInsights } from "@/lib/stats/insights";

// Compact, token-cheap representations of our data for the model. Short keys on purpose.

const score = (m: MatchSummary) => `${m.home.name} ${m.goals.home}-${m.goals.away} ${m.away.name}`;

export function compactMatch(m: MatchSummary) {
  return { match_id: m.id, league: `${m.league.country} ${m.league.name}`, kickoff: m.kickoffAt, home: m.home.name, away: m.away.name, status: m.status };
}

/** Drops nulls so the model is not handed a wall of "not reported" keys to reason about. */
function present<T extends object>(o: T): Partial<T> | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
}

function compactStats(d: MatchDetail) {
  if (d.statistics.length === 0) return undefined;
  return Object.fromEntries(
    d.statistics.map((t) => [
      t.team.name,
      present({
        possession_pct: t.possession,
        shots: t.shotsTotal,
        on_target: t.shotsOnGoal,
        inside_box: t.shotsInsideBox,
        corners: t.corners,
        fouls: t.fouls,
        offsides: t.offsides,
        yellow: t.yellowCards,
        red: t.redCards,
        saves: t.saves,
        passes_accurate: t.passesAccurate,
        xg: t.expectedGoals,
      }),
    ]),
  );
}

function compactLineups(d: MatchDetail) {
  if (d.lineups.length === 0) return undefined;
  return d.lineups.map((l) => ({
    team: l.team.name,
    formation: l.formation,
    coach: l.coach,
    // Names only: the model is reasoning about who is on the pitch, not about shirt numbers.
    start_xi: l.startXI.map((p) => p.name),
  }));
}

function compactEvents(d: MatchDetail) {
  if (d.events.length === 0) return undefined;
  const side = (s: "HOME" | "AWAY") => (s === "HOME" ? d.match.home.name : d.match.away.name);
  return d.events
    .filter((e) => e.type !== "SUBSTITUTION" && e.type !== "VAR")
    .map((e) => `${e.minute}${e.extra ? `+${e.extra}` : ""}' ${e.type} ${side(e.side)}${e.player ? ` (${e.player})` : ""}`);
}

export function compactMatchDetail(d: MatchDetail) {
  const table = d.standings?.filter((r) => r.team.id === d.match.home.id || r.team.id === d.match.away.id);
  return {
    data_source: d.source === "sample" ? "SAMPLE DATA (not real results)" : "API-Football",
    match: compactMatch(d.match),
    form: Object.fromEntries(
      (["home", "away"] as const).map((s) => [
        d.form[s].team.name,
        {
          last: d.form[s].matches.map((r) => `${r.result} ${score(r.match)}`),
          summary: d.form[s].summary,
          // The side that decides most 1X2 and over/under leans: a team that wins at home and
          // loses away looks identical to a mediocre one until these are separated.
          at_home: d.form[s].splits.home,
          away_from_home: d.form[s].splits.away,
        },
      ]),
    ),
    // Which side is which in this fixture, so the model applies the right half of the split.
    venue: { home_side: d.match.home.name, away_side: d.match.away.name },
    h2h: d.h2h.map(score),
    table: table?.map((r) => ({ team: r.team.name, rank: r.rank, played: r.played, points: r.points, gd: r.goalsFor - r.goalsAgainst })),
    key_numbers: matchInsights(d),
    // All three were already fetched for the match page and none of them reached the model, so
    // an analysis of a finished or in-play game never saw a single shot, card or corner.
    team_statistics: compactStats(d),
    lineups: compactLineups(d),
    timeline: compactEvents(d),
    ...(d.unavailable.length ? { not_available_on_stats_plan: d.unavailable } : {}),
  };
}

export function compactSlip(s: SlipView) {
  return {
    slip_id: s.id,
    bookmaker: s.bookmaker.name,
    ...(s.demo ? { demo_data: "sample bookmaker data: this code will not work on the real site" } : {}),
    code: s.code,
    // No code means the bookmaker couldn't book it; say so, or the model implies there is one to paste.
    ...(s.code ? {} : { not_booked: "we could not create a booking code at this bookmaker: tell the user to add these picks themselves" }),
    total_odds: s.totalOdds,
    games: s.selections.map((g) => ({
      pos: g.position,
      match: `${g.home} vs ${g.away}`,
      kickoff: g.kickoffAt,
      market: g.marketLabel,
      pick: g.pickLabel,
      odds: g.odds,
      ...(g.status !== "OK" ? { status: g.status } : {}),
      ...(g.started ? { started: true } : {}),
    })),
    warnings: s.warnings.map((w) => w.message),
    risk: { level: s.risk.level, summary: s.risk.summary, riskiest: s.risk.riskiest.map((r) => `#${r.position}: ${r.reason}`) },
  };
}
