import "server-only";
import type { Market } from "@/lib/markets/types";
import { settleDailyPicks } from "@/lib/services/daily-picks";
import { settleLeg } from "@/lib/services/slip-results";
import { lookupMatch, statsProvider } from "@/lib/services/stats";

/**
 * Settles the published picks from real results only.
 *
 * Shared by both morning jobs on purpose. It used to run only after the generate job, in the same
 * 120-second window, so as unsettled picks piled up the settling was the part that ran out of time
 * - and the backlog it failed to clear made the next day's run slower still. Generating today's
 * picks is the thing people have paid for, so it keeps that slot; settling now also has one of its
 * own, where nothing else is competing with it.
 *
 * A game we cannot confirm stays pending. The published record is the whole point of daily picks,
 * so a leg is decided by the same rules as a user's own slip, and never by a guess.
 */
export async function settlePublishedPicks(): Promise<{ settled: number }> {
  const provider = statsProvider();
  return settleDailyPicks(async (leg) => {
    // Picks published before the fixture id was stored still settle, by looking the game up.
    const match = leg.apiFootballFixtureId
      ? await provider.fixture(leg.apiFootballFixtureId)
      : await lookupMatch(leg.homeTeam, leg.awayTeam, leg.kickoffAt, leg.competition);
    if (!match || match.status !== "FINISHED" || match.goals.home === null || match.goals.away === null) return null;

    const resultText = `${match.goals.home}-${match.goals.away}`;
    const { state } = settleLeg((leg.market as Market | null) ?? null, match);
    // UNKNOWN means the score cannot decide this market (corners, cards, a first-half line). Leaving
    // it pending is honest; guessing it would corrupt the record this product is judged on. A lost
    // leg elsewhere still settles the slip, so one of these no longer holds a result back for ever.
    if (state !== "WON" && state !== "LOST") return null;
    return { status: state, resultText };
  });
}
