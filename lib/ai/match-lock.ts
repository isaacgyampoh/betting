import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { MatchDetail } from "@/lib/stats/types";

/**
 * Locking a conversation to the fixture the user opened it from.
 *
 * The defect this exists to fix: a thread opened from Ipswich v Nottingham Forest, asked for "a
 * two odds for this game", came back with selections from entirely different matches. That was
 * not the model being careless. `build_slip_from_fixtures` searches every fixture on the card and
 * `find_matches` searches every team, and both were offered in a match-scoped conversation - so
 * the model did exactly what the tools invited it to do. The only thing identifying the fixture
 * was one sentence of prose ("the user opened this chat from match_id N"), which is a suggestion,
 * not a constraint.
 *
 * A longer prompt does not fix this, so this does not try to. The fixture is resolved server-side
 * from its authoritative record, injected as structured context rather than prose, the tools that
 * can reach another fixture are **removed from the request**, and the tools that take a match_id
 * are checked against the lock before they run. A model that cannot see a tool cannot call it.
 *
 * What is deliberately *not* done: silently rewriting a wrong match_id to the locked one. That
 * would answer a question about Arsenal with Ipswich's numbers and read as a model hallucination.
 * A mismatch is refused, named, and the model gets to correct itself.
 */

/** The authoritative fixture, as the conversation is allowed to know it. */
export type MatchLock = {
  matchId: number;
  home: { id: number; name: string };
  away: { id: number; name: string };
  competition: string;
  country: string;
  season: number;
  kickoffAt: string;
  status: MatchDetail["match"]["status"];
  statusLabel: string;
  goals: { home: number | null; away: number | null };
  /** Which sections actually have data, so the model never offers what is not there. */
  has: { form: boolean; h2h: boolean; standings: boolean; statistics: boolean; lineups: boolean; events: boolean };
  unavailable: string[];
  source: string;
  fetchedAt: string;
};

export function lockFromDetail(detail: MatchDetail, now: Date = new Date()): MatchLock {
  const m = detail.match;
  return {
    matchId: m.id,
    home: { id: m.home.id, name: m.home.name },
    away: { id: m.away.id, name: m.away.name },
    competition: m.league.name,
    country: m.league.country,
    season: m.league.season,
    kickoffAt: m.kickoffAt,
    status: m.status,
    statusLabel: m.statusLabel,
    goals: m.goals,
    has: {
      form: (detail.form?.home?.summary.played ?? 0) > 0 || (detail.form?.away?.summary.played ?? 0) > 0,
      h2h: detail.h2h.length > 0,
      standings: (detail.standings?.length ?? 0) > 0,
      statistics: detail.statistics.length >= 2,
      lineups: detail.lineups.length >= 2,
      events: detail.events.length > 0,
    },
    unavailable: detail.unavailable,
    source: detail.source,
    fetchedAt: now.toISOString(),
  };
}

/**
 * Tools that can reach a fixture other than the locked one.
 *
 * `build_slip_from_fixtures` searches the whole day's card; `find_matches` searches by team name.
 * Both are the right tools in Claw, where the user is asking about football in general, and both
 * are the wrong tools in a conversation about one game.
 */
const GLOBAL_SEARCH_TOOLS = new Set(["build_slip_from_fixtures", "find_matches"]);

/** Tools that name a fixture by id, and so must name *this* one. */
const MATCH_SCOPED_TOOLS = new Set(["get_match_stats", "analyze_match"]);

/** The tool list a locked conversation is given. Removal is the enforcement; the rest is belt. */
export function lockedTools(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  return tools.filter((t) => !GLOBAL_SEARCH_TOOLS.has(t.name));
}

export type LockCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a tool call is allowed under the lock.
 *
 * Checked on the way in rather than trusted from the tool list, because the two are different
 * failure modes: a model can hallucinate a tool name that is not offered, and a cached prefix can
 * outlive a change to the list.
 */
export function checkToolAgainstLock(lock: MatchLock, name: string, input: unknown): LockCheck {
  const fixture = `${lock.home.name} v ${lock.away.name}`;

  if (GLOBAL_SEARCH_TOOLS.has(name)) {
    return {
      ok: false,
      reason:
        `MATCH_LOCKED: this conversation is about ${fixture} (match_id ${lock.matchId}). ` +
        `${name} searches other fixtures and is not available here. Answer about this match only, ` +
        `using the match context already provided. If this fixture has no prices or no market for ` +
        `what was asked, say so plainly instead of using a different game.`,
    };
  }

  if (MATCH_SCOPED_TOOLS.has(name)) {
    const given = (input as { match_id?: unknown } | null)?.match_id;
    if (typeof given === "number" && given !== lock.matchId) {
      return {
        ok: false,
        reason:
          `MATCH_LOCKED: this conversation is about ${fixture} (match_id ${lock.matchId}), not ` +
          `match_id ${given}. Call ${name} with match_id ${lock.matchId}.`,
      };
    }
  }

  return { ok: true };
}

/**
 * The fixture as structured context, not prose.
 *
 * Sent as its own system block so it is cached alongside the prompt and cannot be edited away by
 * anything in the conversation. It carries what the model needs to refuse honestly: the status, so
 * a finished game is never described as live; the kick-off, so "tonight" means something; and
 * `has`, so it never offers to read statistics a competition does not publish.
 */
export function lockContext(lock: MatchLock, now: Date = new Date()): string {
  return [
    `Current time: ${now.toISOString()} (GMT).`,
    "",
    "THIS CONVERSATION IS LOCKED TO ONE FIXTURE. Every answer must be about this match and no",
    "other. You may not substitute a different fixture for any reason, including better odds, more",
    "statistics or a more promising selection. If this match cannot support what was asked, say so",
    "and explain why - never answer with another game.",
    "",
    JSON.stringify(
      {
        match_id: lock.matchId,
        home: lock.home,
        away: lock.away,
        competition: `${lock.country} ${lock.competition}`,
        season: lock.season,
        kickoff_utc: lock.kickoffAt,
        status: lock.status,
        status_label: lock.statusLabel,
        score: lock.goals,
        data_available: lock.has,
        not_available_on_stats_plan: lock.unavailable,
        data_source: lock.source === "sample" ? "SAMPLE DATA (not real results)" : lock.source,
        data_fetched_at: lock.fetchedAt,
      },
      null,
      1,
    ),
    "",
    statusGuidance(lock),
    "",
    // The failure this targets, observed on a real device against the old build: asked "what are
    // the main risks either way?" on Brest v Nice, the assistant replied "I need to know which
    // match you're asking about"; asked "what changed after half-time?" it replied "I need to
    // know which slip you're asking about". It already had the id in both cases. The general
    // instructions are written for the slip assistant, where "the user means the most recent
    // slip" is the right default; inside a match conversation it is the wrong one, and it turns
    // a direct question into an interrogation.
    "Never ask the user which match they mean. You already know: it is the fixture above, and it",
    "does not change. Never ask for a booking code or a slip id in order to answer a question",
    "about this match - form, statistics, risks, half-time, markets and head-to-head are all",
    "questions about the fixture above, never about a slip. The rule in your general instructions",
    "that the user means their most recent slip does NOT apply in this conversation.",
    "",
    "Answer the question that was asked, directly, using the data you have. If a section needed to",
    "answer it is absent, say which one and answer with what remains.",
    "",
    // The assistant has no tool that changes the app, so it must never report having used one.
    // "Added to your favourites" with nothing added is the single most corrosive thing a chat can
    // say: it is confidently wrong about the user's own data, and they find out days later.
    "You cannot change anything in the app: you cannot follow a match, add a favourite, set an",
    "alert or save anything. If the user asks for one of those, say plainly that the control is",
    "the bell at the top of this sheet and that pressing it does it - never claim to have done it.",
  ].join("\n");
}

/** What the fixture's own state means for what can honestly be said about it. */
function statusGuidance(lock: MatchLock): string {
  switch (lock.status) {
    case "FINISHED":
      return "This match is FINISHED. Discuss it in the past tense. Never describe it as upcoming or in play, and never offer a selection on it.";
    case "LIVE":
      return `This match is IN PLAY (${lock.statusLabel}). The score above may already be out of date; say so when it matters.`;
    case "POSTPONED":
    case "CANCELLED":
      return `This match is ${lock.status}. It will not be played as scheduled. Do not offer any selection on it.`;
    default:
      return "This match has not kicked off. There is no score, no timeline and no match statistics yet; do not imply otherwise.";
  }
}
