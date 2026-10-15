import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { logger } from "@/lib/logger";
import { getSlip } from "@/lib/services/slips";
import { lookupMatch } from "@/lib/services/stats";
import type { Market } from "@/lib/markets/types";
import type { MatchSummary } from "@/lib/stats/types";

// "How's my ticket doing?" — the live state of every game on a saved slip.
//
// We settle only what a full-time scoreline can settle on its own: goals totals, both-teams-to-score
// and the result markets. Anything else — corners, cards, fouls, first-half lines — is reported as
// still to be checked at the bookmaker rather than guessed from a score that cannot decide it.

export type LegState = "WON" | "LOST" | "RUNNING" | "NOT_STARTED" | "UNKNOWN";

export type LegResult = {
  position: number;
  game: string;
  pick: string;
  odds: number | null;
  state: LegState;
  /** Live or final score, when we have one. */
  score: string | null;
  /** Where the game is: "FT", "52'", "Not started". */
  clock: string | null;
  /** Why it is in that state, in one line. */
  note: string;
};

export type SlipResults = {
  slipId: string;
  code: string | null;
  bookmaker: string;
  totalOdds: number | null;
  /** Overall: lost if any leg lost, won if all won, otherwise still running. */
  state: "WON" | "LOST" | "RUNNING";
  won: number;
  lost: number;
  running: number;
  unknown: number;
  legs: LegResult[];
};

const goalsOf = (m: MatchSummary) => ({ home: m.goals.home ?? 0, away: m.goals.away ?? 0 });
const finished = (m: MatchSummary) => m.status === "FINISHED";

/**
 * The goals that count for a market's period.
 *
 * Null when the period cannot be worked out, which is what keeps a leg honestly unsettled rather
 * than settled from the wrong number. A first half needs the half-time score; a second half is the
 * rest of the match, so it needs the half-time score and a finished game.
 *
 * The provider carries a half-time score on about 94% of finished fixtures. It does not carry shot
 * or corner counts on more than 16%, which is why those markets are still not settled from here.
 */
function goalsForPeriod(m: MatchSummary, period: Market["period"]): { home: number; away: number } | null {
  if (period === "FT") return goalsOf(m);
  const ht = m.halftime;
  if (!ht || ht.home === null || ht.away === null) return null;
  if (period === "H1") return { home: ht.home, away: ht.away };
  // The second half is whatever has been added since the break, which is knowable while it is
  // still being played - it just is not final until the match is.
  const full = goalsOf(m);
  return { home: full.home - ht.home, away: full.away - ht.away };
}

/** A half is over once the half-time score exists; the match being live is not enough. */
function periodDecided(m: MatchSummary, period: Market["period"]): boolean {
  if (period === "FT" || period === "H2") return finished(m);
  return m.halftime?.home !== null && m.halftime?.home !== undefined;
}

/**
 * Settles one pick against a score. `final` says whether the game is over: a pick can be won early
 * (over 1.5 with two goals in) but only lost once nothing can change it.
 */
/**
 * Whether a final score alone can decide this market.
 *
 * Goal markets can, for either half as well as the match: the provider carries a half-time score on
 * about 94% of finished fixtures, and the second half is the rest. One team's own total is in the
 * score as much as the match total is, so that counts too.
 *
 * Corners, cards, fouls and shots cannot. They are not in a score, and the only numbers for them -
 * the provider's match statistics - exist for 16% of finished fixtures, almost all of it the bigger
 * competitions. Publishing a market we could settle one time in six would put the public record
 * back where it was: slips stuck at "still running" for ever. Those stay a chat answer, where "check
 * this one at the bookmaker" is honest and holds nothing up.
 */
export function canSettleFromScore(pick: Market | null): boolean {
  if (!pick) return false;
  switch (pick.type) {
    case "OVER_UNDER":
    case "TEAM_OVER_UNDER":
      return pick.line !== null;
    case "BTTS":
    case "MATCH_RESULT":
    case "DOUBLE_CHANCE":
      return true;
    default:
      return false;
  }
}

export function settleLeg(pick: Market | null, match: MatchSummary): { state: LegState; note: string } {
  const matchFinal = finished(match);
  const live = match.status === "LIVE" || matchFinal;
  if (!live) return { state: "NOT_STARTED", note: "Not kicked off yet." };

  const unknown = {
    state: "UNKNOWN" as const,
    note: matchFinal ? "Finished — check this market at the bookmaker." : "Running — we can't settle this market from the score.",
  };
  if (!pick) return unknown;

  // Everything below reads the goals for this market's period, not the match's. A half-time line is
  // decided by the half-time score, and is already decided while the second half is still running.
  const scoped = goalsForPeriod(match, pick.period);
  // No half-time score yet. While the match is live that is just "too early", not "unknowable";
  // only a finished match whose half-time score never arrived is genuinely beyond us.
  if (!scoped) {
    return matchFinal ? unknown : { state: "RUNNING", note: "Running — the half-time score isn't in yet." };
  }
  const g = scoped;
  const t = g.home + g.away;
  const final = periodDecided(match, pick.period);
  const where = pick.period === "FT" ? "Finished" : pick.period === "H1" ? "At half time" : "In the second half";

  const decide = (won: boolean, lostWhenFinal: boolean, wonNote: string, pendingNote: string) => {
    if (won) return { state: "WON" as const, note: wonNote };
    if (final && lostWhenFinal) return { state: "LOST" as const, note: `${where} ${g.home}-${g.away}.` };
    return { state: final ? ("LOST" as const) : ("RUNNING" as const), note: final ? `${where} ${g.home}-${g.away}.` : pendingNote };
  };

  switch (pick.type) {
    case "OVER_UNDER": {
      if (pick.line === null) break;
      if (pick.outcome === "OVER") {
        return decide(t > pick.line, t <= pick.line, `${t} goals in, over ${pick.line} is already safe.`, `${t} goals so far, needs over ${pick.line}.`);
      }
      // Under can only be settled at full time; before that it is merely still alive.
      if (t > pick.line) return { state: "LOST", note: `${t} goals in, under ${pick.line} has gone.` };
      return final
        ? { state: "WON", note: `Finished ${g.home}-${g.away}, under ${pick.line}.` }
        : { state: "RUNNING", note: `${t} goals so far, still under ${pick.line}.` };
    }
    case "BTTS": {
      const both = g.home > 0 && g.away > 0;
      if (pick.outcome === "YES") {
        return decide(both, !both, `Both have scored (${g.home}-${g.away}).`, `${g.home}-${g.away}, still needs both to score.`);
      }
      if (both) return { state: "LOST", note: `Both scored (${g.home}-${g.away}).` };
      return final ? { state: "WON", note: `${where} ${g.home}-${g.away}.` } : { state: "RUNNING", note: `${g.home}-${g.away}, still alive.` };
    }
    case "TEAM_OVER_UNDER": {
      // One side's own goals are in the final score as much as the total is.
      if (pick.line === null) break;
      const side = pick.outcome.startsWith("HOME") ? g.home : g.away;
      const who = pick.outcome.startsWith("HOME") ? match.home.name : match.away.name;
      if (pick.outcome.endsWith("OVER")) {
        return decide(side > pick.line, side <= pick.line, `${who} have ${side}, over ${pick.line} is already safe.`, `${who} on ${side}, needs over ${pick.line}.`);
      }
      if (side > pick.line) return { state: "LOST", note: `${who} have ${side}, under ${pick.line} has gone.` };
      return final
        ? { state: "WON", note: `${where} ${g.home}-${g.away}; ${who} under ${pick.line}.` }
        : { state: "RUNNING", note: `${who} on ${side}, still under ${pick.line}.` };
    }
    case "MATCH_RESULT":
    case "DOUBLE_CHANCE": {
      const leader = g.home > g.away ? "HOME" : g.away > g.home ? "AWAY" : "DRAW";
      const covered =
        pick.outcome === leader ||
        (pick.outcome === "HOME_DRAW" && leader !== "AWAY") ||
        (pick.outcome === "DRAW_AWAY" && leader !== "HOME") ||
        (pick.outcome === "HOME_AWAY" && leader !== "DRAW");
      if (!final) return { state: "RUNNING", note: `${g.home}-${g.away}, ${covered ? "currently covered" : "not covered yet"}.` };
      return covered
        ? { state: "WON", note: `${where} ${g.home}-${g.away}.` }
        : { state: "LOST", note: `${where} ${g.home}-${g.away}.` };
    }
  }
  return {
    state: "UNKNOWN",
    note: final ? "Finished — check this market at the bookmaker." : "Running — we can't settle this market from the score.",
  };
}

function clockOf(m: MatchSummary): string {
  return m.status === "FINISHED" ? "FT" : m.statusLabel || (m.status === "LIVE" ? "Live" : "Not started");
}

/** Every leg of a saved slip, with its live state. */
export async function getSlipResults(user: AuthUser, slipId: string): Promise<SlipResults> {
  const slip = await getSlip(user, slipId);

  const legs = await mapWithConcurrency(slip.selections, 4, async (s): Promise<LegResult> => {
    const base = {
      position: s.position,
      game: `${s.home} v ${s.away}`,
      pick: s.pickLabel,
      odds: s.odds ?? null,
    };
    let match: MatchSummary | null = null;
    try {
      match = await lookupMatch(s.home, s.away, new Date(s.kickoffAt), s.competition);
    } catch (error) {
      logger.warn("results.lookup_failed", { slipId, home: s.home, away: s.away, error: String(error) });
    }
    if (!match) {
      return { ...base, state: "UNKNOWN", score: null, clock: null, note: "We couldn't find this game in our stats to check it." };
    }
    const { state, note } = settleLeg(s.market, match);
    const score = match.goals.home === null ? null : `${match.goals.home}-${match.goals.away}`;
    return { ...base, state, score, clock: clockOf(match), note };
  });

  const count = (s: LegState) => legs.filter((l) => l.state === s).length;
  const lost = count("LOST");
  const won = count("WON");
  const unknown = count("UNKNOWN");
  const running = legs.length - lost - won - unknown;

  return {
    slipId: slip.id,
    code: slip.code,
    bookmaker: slip.bookmaker.name,
    totalOdds: slip.totalOdds,
    // One lost leg kills an accumulator, whatever the rest are doing.
    state: lost > 0 ? "LOST" : won === legs.length ? "WON" : "RUNNING",
    won,
    lost,
    running,
    unknown,
    legs,
  };
}
