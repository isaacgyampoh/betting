import type { MatchDetail, MatchSummary, TeamForm } from "@/lib/stats/types";

// Evidence for one pick, drawn from real results: recent form, home/away splits and head-to-head.
//
// Every sentence here is a count of things that actually happened ("7 of their last 10 went over
// 1.5"), never a prediction and never a number we made up. If the stats don't cover a market we
// return null and the pick stands on the bookmaker's price alone — which is honest, and better than
// dressing a price up as analysis.

export type PickShape = {
  /** Our internal market type, when the pick maps to one. */
  type?: string;
  outcome: string;
  line: number | null;
  /** The bookmaker's market id, so we can recognise corners/cards we don't model. */
  marketId: string;
};

export type Evidence = {
  /** One sentence, ready to show. */
  text: string;
  /** 0..1: how strongly recent results back this pick. Used to rank picks, never shown as a price. */
  support: number;
  /** How many games the sentence is counted from, so thin samples can be discounted. */
  sample: number;
};

const goalsIn = (m: MatchSummary) => (m.goals.home ?? 0) + (m.goals.away ?? 0);
const played = (m: MatchSummary) => m.goals.home !== null && m.goals.away !== null;

/** "9 of 10" rather than "90%": a count is checkable, a percentage hides the sample size. */
const outOf = (hits: number, total: number) => `${hits} of ${total}`;

function overRate(form: TeamForm, line: number, side?: "home" | "away") {
  const games = form.matches.filter((m) => played(m.match) && (side === undefined || (side === "home") === m.wasHome));
  const hits = games.filter((m) => goalsIn(m.match) > line).length;
  return { hits, total: games.length };
}

function unbeatenRate(form: TeamForm, side?: "home" | "away") {
  const games = form.matches.filter((m) => side === undefined || (side === "home") === m.wasHome);
  const hits = games.filter((m) => m.result !== "L").length;
  return { hits, total: games.length };
}

function winRate(form: TeamForm, side?: "home" | "away") {
  const games = form.matches.filter((m) => side === undefined || (side === "home") === m.wasHome);
  return { hits: games.filter((m) => m.result === "W").length, total: games.length };
}

function bttsRate(form: TeamForm) {
  const games = form.matches.filter((m) => played(m.match));
  const hits = games.filter((m) => (m.match.goals.home ?? 0) > 0 && (m.match.goals.away ?? 0) > 0).length;
  return { hits, total: games.length };
}

function h2hOver(h2h: MatchSummary[], line: number) {
  const games = h2h.filter(played);
  return { hits: games.filter((m) => goalsIn(m) > line).length, total: games.length };
}

function totalsEvidence(d: MatchDetail, line: number, over: boolean): Evidence | null {
  const home = overRate(d.form.home, line);
  const away = overRate(d.form.away, line);
  if (!home.total || !away.total) return null;

  const h2h = h2hOver(d.h2h, line);
  const hit = (r: { hits: number; total: number }) => (over ? r.hits : r.total - r.hits);
  const hShare = hit(home) / home.total;
  const aShare = hit(away) / away.total;

  const word = over ? "went over" : "stayed under";
  const parts = [
    `${d.form.home.team.name}'s games ${word} ${line} in ${outOf(hit(home), home.total)}`,
    `${d.form.away.team.name}'s in ${outOf(hit(away), away.total)}`,
  ];
  // Head-to-head only earns a mention when there is enough of it to mean something.
  let support = (hShare + aShare) / 2;
  let sample = home.total + away.total;
  if (h2h.total >= 3) {
    const hh = hit(h2h) / h2h.total;
    parts.push(`and ${outOf(hit(h2h), h2h.total)} of their meetings did too`);
    support = support * 0.7 + hh * 0.3;
    sample += h2h.total;
  }
  return { text: `${parts.join(", ")}.`, support, sample };
}

function resultEvidence(d: MatchDetail, outcome: string): Evidence | null {
  // Which side the pick needs, and whether a draw is good enough.
  const backsHome = outcome === "HOME" || outcome === "HOME_DRAW";
  const backsAway = outcome === "AWAY" || outcome === "DRAW_AWAY";
  if (!backsHome && !backsAway) return null;
  const drawCounts = outcome === "HOME_DRAW" || outcome === "DRAW_AWAY";

  const backed = backsHome ? d.form.home : d.form.away;
  const other = backsHome ? d.form.away : d.form.home;
  const backedSide = backsHome ? "home" : "away";
  const otherSide = backsHome ? "away" : "home";

  const mine = drawCounts ? unbeatenRate(backed, backedSide) : winRate(backed, backedSide);
  if (!mine.total) return null;

  const verb = drawCounts ? "avoided defeat" : "won";
  const where = backedSide === "home" ? "at home" : "away";
  const parts = [`${backed.team.name} ${verb} in ${outOf(mine.hits, mine.total)} ${where}`];

  let support = mine.hits / mine.total;
  let sample = mine.total;
  const theirs = winRate(other, otherSide);
  if (theirs.total) {
    const theirWhere = otherSide === "home" ? "at home" : "away";
    parts.push(`${other.team.name} won just ${outOf(theirs.hits, theirs.total)} ${theirWhere}`);
    support = support * 0.65 + (1 - theirs.hits / theirs.total) * 0.35;
    sample += theirs.total;
  }
  return { text: `${parts.join(", while ")}.`, support, sample };
}

function bttsEvidence(d: MatchDetail, yes: boolean): Evidence | null {
  const home = bttsRate(d.form.home);
  const away = bttsRate(d.form.away);
  if (!home.total || !away.total) return null;
  const hit = (r: { hits: number; total: number }) => (yes ? r.hits : r.total - r.hits);
  const phrase = yes ? "saw both teams score" : "had at least one side fail to score";
  return {
    text: `${d.form.home.team.name}'s games ${phrase} in ${outOf(hit(home), home.total)}, ${d.form.away.team.name}'s in ${outOf(hit(away), away.total)}.`,
    support: (hit(home) / home.total + hit(away) / away.total) / 2,
    sample: home.total + away.total,
  };
}

/**
 * The strongest honest sentence we can write about this pick, or null when recent results say
 * nothing useful about that market (corners, cards and fouls are not in the stats we hold).
 */
export function evidenceFor(pick: PickShape, d: MatchDetail): Evidence | null {
  switch (pick.marketId) {
    case "18": // Over/Under, full time
      if (pick.line === null) return null;
      return totalsEvidence(d, pick.line, pick.outcome === "OVER");
    case "29": // Both teams to score
      return bttsEvidence(d, pick.outcome === "YES");
    case "1": // 1X2
    case "10": // Double chance
      return resultEvidence(d, pick.outcome);
    default:
      // First-half, team totals, corners, cards and fouls: no comparable history in what we hold.
      return null;
  }
}

/** A one-line note when we looked and found nothing, so silence is never mistaken for agreement. */
export const NO_EVIDENCE = "No recent-results history for this market, so this rests on the price alone.";
