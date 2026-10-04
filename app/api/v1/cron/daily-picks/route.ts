import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { generateDailyPicks } from "@/lib/services/daily-picks";
import { settlePublishedPicks } from "@/lib/services/settle-published";

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
  const settled = await settlePublishedPicks();

  logger.info("cron.daily_picks", { ...generated, settled: settled.settled });
  return NextResponse.json({ data: { ...generated, settled: settled.settled } });
}
