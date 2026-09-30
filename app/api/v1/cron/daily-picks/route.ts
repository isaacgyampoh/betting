import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { generateDailyPicks, settleDailyPicks } from "@/lib/services/daily-picks";
import { statsProvider } from "@/lib/services/stats";

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

  // Settle from real results only; a game we can't confirm stays pending.
  const provider = statsProvider();
  const settled = await settleDailyPicks(async (leg) => {
    if (!leg.apiFootballFixtureId) return null;
    const match = await provider.fixture(leg.apiFootballFixtureId);
    if (!match || match.status !== "FINISHED" || match.goals.home === null || match.goals.away === null) return null;
    // Result recorded here; per-leg win/lose is decided by the market stored with the leg.
    return { status: "PENDING", resultText: `${match.goals.home}-${match.goals.away}` };
  });

  logger.info("cron.daily_picks", { ...generated, settled: settled.settled });
  return NextResponse.json({ data: { ...generated, settled: settled.settled } });
}
