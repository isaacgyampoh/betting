import { ok, route } from "@/lib/api";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error("health.db_unreachable", { err });
    throw new AppError("INTERNAL", "Database unreachable.");
  }
  return ok({ status: "ok", time: new Date().toISOString() });
});
