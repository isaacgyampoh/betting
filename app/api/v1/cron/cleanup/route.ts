import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { cleanup } from "@/lib/services/maintenance";
import { settlePublishedPicks } from "@/lib/services/settle-published";

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
  logger.info("cron.cleanup", { ...result, settled: settled.settled });
  return NextResponse.json({ data: { ...result, settled: settled.settled } });
}
