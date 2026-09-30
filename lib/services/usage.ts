import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { UsageKind } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";

export type UsageEntry = {
  userId: string | null;
  ipHash?: string | null;
  kind: UsageKind;
  success: boolean;
  errorCode?: string | null;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  meta?: Prisma.InputJsonValue;
};

/** Records a metered request. Never throws: metering must not break the user's request. */
export async function logUsage(entry: UsageEntry): Promise<void> {
  try {
    await db.usageLog.create({ data: entry });
  } catch (err) {
    logger.error("usage.log_failed", { kind: entry.kind, userId: entry.userId, err });
  }
}

/** Sliding-window limit on usage_logs rows (counts failed attempts too, to stop hammering). */
export async function enforceRateLimit(opts: { userId: string; kind: UsageKind; limit: number; windowMs: number }) {
  const since = new Date(Date.now() - opts.windowMs);
  const count = await db.usageLog.count({
    where: { userId: opts.userId, kind: opts.kind, createdAt: { gte: since } },
  });
  if (count >= opts.limit) {
    const minutes = Math.round(opts.windowMs / 60_000);
    throw new AppError("RATE_LIMITED", `You've reached the limit of ${opts.limit} per ${minutes} minutes. Please wait a bit and try again.`);
  }
}
