import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { runMatchAlerts } from "@/lib/services/match-alerts";

// Reading live matches and sending can take a while when several are in play at once.
export const maxDuration = 60;

/**
 * One pass of the match alerting.
 *
 * Meant to be called often while matches are live - every minute or two. It is safe at any
 * interval and safe to call twice at once: every alert is claimed through a unique index before
 * it is sent, so a second caller finds the row taken and sends nothing.
 *
 * Authorised the same way as the other cron routes, by a shared secret compared in constant
 * time. Read straight from the environment so authorisation does not depend on the rest of the
 * configuration being valid.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    given.length !== expected.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMatchAlerts();
    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error("cron.match_alerts_failed", { err });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
