import type { MatchDetail, MatchSummary } from "@/lib/stats/types";
import type { SlipView } from "@/lib/slips/view";
import { matchInsights } from "@/lib/stats/insights";

// Compact, token-cheap representations of our data for the model. Short keys on purpose.

const score = (m: MatchSummary) => `${m.home.name} ${m.goals.home}-${m.goals.away} ${m.away.name}`;

export function compactMatch(m: MatchSummary) {
  return { match_id: m.id, league: `${m.league.country} ${m.league.name}`, kickoff: m.kickoffAt, home: m.home.name, away: m.away.name, status: m.status };
}

export function compactMatchDetail(d: MatchDetail) {
  const table = d.standings?.filter((r) => r.team.id === d.match.home.id || r.team.id === d.match.away.id);
  return {
    data_source: d.source === "sample" ? "SAMPLE DATA (not real results)" : "API-Football",
    match: compactMatch(d.match),
    form: Object.fromEntries(
      (["home", "away"] as const).map((s) => [
        d.form[s].team.name,
        { last: d.form[s].matches.map((r) => `${r.result} ${score(r.match)}`), summary: d.form[s].summary },
      ]),
    ),
    h2h: d.h2h.map(score),
    table: table?.map((r) => ({ team: r.team.name, rank: r.rank, played: r.played, points: r.points, gd: r.goalsFor - r.goalsAgainst })),
    key_numbers: matchInsights(d),
    ...(d.unavailable.length ? { not_available_on_stats_plan: d.unavailable } : {}),
  };
}

export function compactSlip(s: SlipView) {
  return {
    slip_id: s.id,
    bookmaker: s.bookmaker.name,
    ...(s.demo ? { demo_data: "sample bookmaker data: this code will not work on the real site" } : {}),
    code: s.code,
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
