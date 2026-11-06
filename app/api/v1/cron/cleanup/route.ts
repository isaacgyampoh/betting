import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { cleanup } from "@/lib/services/maintenance";
import { settlePublishedPicks } from "@/lib/services/settle-published";
import { refreshSpecialOdds, settleSpecialPicks } from "@/lib/services/settle-special";

// Early-morning job (Cloudflare Cron, see wrangler.jsonc), with `Authorization: Bearer $CRON_SECRET`.
//
// It also settles the published picks. That is not housekeeping: it is here because settling needs
// a window where nothing else is competing for the time, and this slot has one.
export async function GET(req: NextRequest) {
  // Read directly: authorization must not depend on the rest of the environment being valid.
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await cleanup();
  // Settling must not be able to fail the cleanup, or a stats outage would stop both.
  const settled = await settlePublishedPicks().catch((err) => {
    logger.warn("cron.settle_failed", { err });
    return { settled: 0 };
  });
  // Special picks settle here for the same reason: grading reads match statistics, and this is the
  // slot where nothing else is competing for the provider's allowance. Guarded like the above - a
  // stats outage must not take the cleanup down with it.
  const special = await settleSpecialPicks().catch((err) => {
    logger.warn("cron.settle_special_failed", { err });
    return { settled: 0, voided: 0, waiting: 0, slips: 0 };
  });
  // Prices are re-read once a day, which is all two cron triggers afford. The published price is
  // never overwritten; a move is a new row in the history.
  const odds = await refreshSpecialOdds().catch((err) => {
    logger.warn("cron.refresh_odds_failed", { err });
    return { checked: 0, moved: 0 };
  });

  logger.info("cron.cleanup", { ...result, settled: settled.settled, special, odds });
  return NextResponse.json({ data: { ...result, settled: settled.settled, special, odds } });
}
