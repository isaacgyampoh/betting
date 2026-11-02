import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { generateDailyPicks } from "@/lib/services/daily-picks";
import { notifySpecialPicks } from "@/lib/services/special-notify";
import { generateSpecialPicks } from "@/lib/services/special-picks";
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

  // Daily Special Picks runs in the same slot but is guarded separately: it reads a bookmaker's
  // full market list and researches several fixtures, so it is the most likely of the three to
  // fail, and it must not be able to stop the accumulator picks publishing.
  const special = await generateSpecialPicks().catch((err: unknown) => {
    logger.warn("cron.special_picks_failed", { err: String(err) });
    return { date: "", published: 0, skipped: ["Research did not complete."] };
  });

  // Notified from the published rows, not from `special.published`, so a rerun does not announce
  // a day twice and a day where nothing qualified stays silent. Guarded for the same reason as
  // above: a push service being down is not a reason for the job to report failure.
  const notified = await notifySpecialPicks().catch((err: unknown) => {
    logger.warn("cron.special_notify_failed", { err: String(err) });
    return { notified: 0, alreadyNotified: 0, recipients: 0 };
  });

  logger.info("cron.daily_picks", {
    ...generated,
    settled: settled.settled,
    specialPublished: special.published,
    specialNotified: notified.notified,
  });
  return NextResponse.json({ data: { ...generated, settled: settled.settled, special: { ...special, notified: notified.notified } } });
}
