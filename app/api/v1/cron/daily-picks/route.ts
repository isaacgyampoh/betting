import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { generateDailyPicks, settleDailyPicks } from "@/lib/services/daily-picks";
import { settleLeg } from "@/lib/services/slip-results";
import { lookupMatch, statsProvider } from "@/lib/services/stats";
import type { Market } from "@/lib/markets/types";

export const maxDuration = 120;

/** Morning job (Cloudflare Cron): publish today's picks, then settle any finished games. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const generated = await generateDailyPicks();

  // Settle from real results only; a game we can't confirm stays pending. The published record is
  // the whole point of daily picks, so a leg is decided by the same rules as a user's own slip.
  const provider = statsProvider();
  const settled = await settleDailyPicks(async (leg) => {
    // Picks published before the fixture id was stored still settle, by looking the game up.
    const match = leg.apiFootballFixtureId
      ? await provider.fixture(leg.apiFootballFixtureId)
      : await lookupMatch(leg.homeTeam, leg.awayTeam, leg.kickoffAt);
    if (!match || match.status !== "FINISHED" || match.goals.home === null || match.goals.away === null) return null;

    const resultText = `${match.goals.home}-${match.goals.away}`;
    const { state } = settleLeg((leg.market as Market | null) ?? null, match);
    // UNKNOWN means the score cannot decide this market (corners, cards, a first-half line). Leaving
    // it pending is honest; guessing it would corrupt the record this product is judged on.
    if (state !== "WON" && state !== "LOST") return null;
    return { status: state, resultText };
  });

  logger.info("cron.daily_picks", { ...generated, settled: settled.settled });
  return NextResponse.json({ data: { ...generated, settled: settled.settled } });
}
