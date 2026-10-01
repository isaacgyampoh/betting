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
const total = (m: MatchSummary) => goalsOf(m).home + goalsOf(m).away;
const finished = (m: MatchSummary) => m.status === "FINISHED";

/**
 * Settles one pick against a score. `final` says whether the game is over: a pick can be won early
 * (over 1.5 with two goals in) but only lost once nothing can change it.
 */
export function settleLeg(pick: Market | null, match: MatchSummary): { state: LegState; note: string } {
  const g = goalsOf(match);
  const t = total(match);
  const final = finished(match);
  const live = match.status === "LIVE" || final;
  if (!live) return { state: "NOT_STARTED", note: "Not kicked off yet." };

  const decide = (won: boolean, lostWhenFinal: boolean, wonNote: string, pendingNote: string) => {
    if (won) return { state: "WON" as const, note: wonNote };
    if (final && lostWhenFinal) return { state: "LOST" as const, note: `Finished ${g.home}-${g.away}.` };
    return { state: final ? ("LOST" as const) : ("RUNNING" as const), note: final ? `Finished ${g.home}-${g.away}.` : pendingNote };
  };

  // Only full-time markets can be settled from a final score; a first-half line needs the
  // half-time score, which we do not hold.
  if (!pick || pick.period !== "FT") {
    return {
      state: "UNKNOWN",
      note: final ? "Finished — check this market at the bookmaker." : "Running — we can't settle this market from the score.",
    };
  }

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
      return final ? { state: "WON", note: `Finished ${g.home}-${g.away}.` } : { state: "RUNNING", note: `${g.home}-${g.away}, still alive.` };
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
        ? { state: "WON", note: `Finished ${g.home}-${g.away}.` }
        : { state: "LOST", note: `Finished ${g.home}-${g.away}.` };
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
