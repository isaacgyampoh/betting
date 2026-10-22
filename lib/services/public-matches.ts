import { readViaApi } from "@/lib/services/remote-data";
import { listMatches, type LeagueGroup } from "@/lib/services/stats";
import type { MatchSummary } from "@/lib/stats/types";

/**
 * Today's real fixtures, for the front page.
 *
 * The landing page claims GameClaw follows every match. The cheapest way to prove that claim is to
 * show the actual games, with the actual minute, to someone who has not installed anything - so
 * this reads the same data the app reads, through the same provider, and the page renders whatever
 * is genuinely happening.
 *
 * Nothing here is allowed to invent a fixture. If the provider is unreachable the function returns
 * null and the caller omits the section entirely; a scoreboard of plausible-looking placeholder
 * matches would be worse than no scoreboard, because a visitor cannot tell the difference.
 *
 * Two routes to the same data, because only one of them works in each place this runs:
 *
 *   - On Cloudflare, `GC_DATA_API_BASE` is set and `readViaApi` fetches the public `/matches`
 *     endpoint. The Worker cannot reach Postgres (see `remote-data.ts`) and has no provider key.
 *   - On Render the variable is unset, `readViaApi` returns null, and `listMatches` runs directly
 *     against the provider with its cache - which is also what the app's own callers use, so the
 *     upstream request is usually already paid for.
 */
const MAX_ROWS = 5;

/** Two from any one competition, so five live games are not five fixtures from one cup round. */
const MAX_PER_LEAGUE = 2;

type DayPayload = {
  groups: LeagueGroup[];
  /** How many fixtures the app's own list carries for the day, after its 150-match cap. */
  shown: number;
};

export type Scoreboard = {
  /** In progress right now, in competition order. */
  live: MatchSummary[];
  /** The next games to start today - or, late at night, the last ones to finish. */
  upcoming: MatchSummary[];
  /** How many fixtures today's list holds in total, for an honest "and N more". */
  listed: number;
};

/**
 * Ranked by the position of the fixture's competition in the day's group list.
 *
 * `listedGroups` has already sorted those groups by the app's PRIORITY table, so the group index
 * *is* the editorial order and this needs no judgement of its own. Sorting the flattened list by
 * kick-off instead put a Liga Alef match above the Europa Conference League, because what leads
 * the board was then decided by whichever game happened to start last.
 */
function ranked(groups: LeagueGroup[], keep: (m: MatchSummary) => boolean): MatchSummary[] {
  const out: MatchSummary[] = [];
  groups.forEach((group) => {
    group.matches
      .filter(keep)
      .slice(0, MAX_PER_LEAGUE)
      .forEach((match) => out.push(match));
  });
  return out;
}

async function loadToday(date: string): Promise<DayPayload | null> {
  const remote = await readViaApi<DayPayload>(`/matches?date=${date}`);
  if (remote) return remote;
  // Unset GC_DATA_API_BASE means this process owns the provider key; a remote read that failed
  // means the API is down, and in both cases going direct is the right next attempt.
  try {
    return await listMatches(date);
  } catch {
    return null;
  }
}

export async function todaysScoreboard(now: Date = new Date()): Promise<Scoreboard | null> {
  const date = now.toISOString().slice(0, 10);
  const day = await loadToday(date);
  if (!day?.groups?.length) return null;

  const live = ranked(day.groups, (m) => m.status === "LIVE").slice(0, MAX_ROWS);

  // Late at night both of these can be empty while the day still had a full card, so the last
  // results stand in: still real, and they still answer "is my league in here?".
  const next = ranked(day.groups, (m) => m.status === "SCHEDULED" && Date.parse(m.kickoffAt) > now.getTime());
  const finished = ranked(day.groups, (m) => m.status === "FINISHED").reverse();

  const listed = day.shown ?? day.groups.reduce((n, g) => n + g.matches.length, 0);

  return {
    live,
    upcoming: (next.length ? next : finished).slice(0, Math.max(0, MAX_ROWS - live.length)),
    listed,
  };
}
