import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

// 200 when the app can serve users; 503 with the reason otherwise (setting names only, no values).
export async function GET() {
  const r = readiness();
  const base = { time: new Date().toISOString(), features: r.features };
  if (!r.ready) {
    return NextResponse.json({ data: { status: "not_configured", missing: r.missing, ...base } }, { status: 503 });
  }
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error("health.db_unreachable", { err });
    return NextResponse.json({ data: { status: "database_unreachable", ...base } }, { status: 503 });
  }
  return NextResponse.json({ data: { status: "ok", ...base } });
}
