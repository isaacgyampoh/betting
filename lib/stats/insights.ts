import type { MatchDetail } from "@/lib/stats/types";

// Plain factual statements derived from the stats. Descriptive only: never a prediction.
export function matchInsights(d: MatchDetail): string[] {
  const out: string[] = [];
  for (const side of ["home", "away"] as const) {
    const f = d.form[side];
    const s = f.summary;
    if (!s.played) continue;
    out.push(`${f.team.name}: ${s.won}W ${s.drawn}D ${s.lost}L in the last ${s.played}, scoring ${s.goalsFor} and conceding ${s.goalsAgainst}.`);
    if (s.bttsRate >= 0.6) out.push(`Both teams scored in ${Math.round(s.bttsRate * s.played)} of ${f.team.name}'s last ${s.played} games.`);
    if (s.over25Rate >= 0.6) out.push(`${Math.round(s.over25Rate * s.played)} of ${f.team.name}'s last ${s.played} games had over 2.5 goals.`);
    if (s.over25Rate <= 0.2 && s.played >= 4) out.push(`Only ${Math.round(s.over25Rate * s.played)} of ${f.team.name}'s last ${s.played} games had over 2.5 goals.`);
  }
  if (d.h2h.length) {
    const homeId = d.match.home.id;
    let hw = 0, aw = 0, dr = 0;
    for (const m of d.h2h) {
      const hg = m.home.id === homeId ? m.goals.home! : m.goals.away!;
      const ag = m.home.id === homeId ? m.goals.away! : m.goals.home!;
      if (hg > ag) hw++;
      else if (ag > hg) aw++;
      else dr++;
    }
    out.push(`Last ${d.h2h.length} meetings: ${d.match.home.name} ${hw} wins, ${d.match.away.name} ${aw} wins, ${dr} draws.`);
  }
  if (d.standings) {
    const pos = (id: number) => d.standings!.find((r) => r.team.id === id);
    const h = pos(d.match.home.id);
    const a = pos(d.match.away.id);
    if (h && a) out.push(`Table: ${d.match.home.name} ${ordinal(h.rank)} (${h.points} pts), ${d.match.away.name} ${ordinal(a.rank)} (${a.points} pts).`);
  }
  return out;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
