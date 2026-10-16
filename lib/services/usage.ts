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
  cacheReadTokens?: number;
  costMicroUsd?: number;
  meta?: Prisma.InputJsonValue;
};

/**
 * What one address may read in an hour without an account.
 *
 * Generous for a person - a long browsing session is well under this - and a hard ceiling on the
 * provider quota that sits behind these pages, which is a few hundred requests a minute shared by
 * everybody. A signed-in reader is counted by id instead and gets the same allowance.
 */
export const PUBLIC_BROWSE_LIMIT = { limit: 300, windowMs: 60 * 60_000 };

/**
 * Meters one public football read, and records it when there is no account behind it.
 *
 * The row is what makes the address-keyed limit mean anything - counting rows nobody writes
 * counts to zero for ever. Signed-in readers are deliberately not written here: the match centre
 * already records its own usage against the user, and a second row would halve the allowance
 * they were given.
 */
export async function meterPublicBrowse(userId: string | null | undefined, ipHash: string | null) {
  await enforceRateLimit({ userId, ipHash, kind: "STATS", ...PUBLIC_BROWSE_LIMIT });
  if (!userId) await logUsage({ userId: null, ipHash, kind: "STATS", success: true });
}

/** Records a metered request. Never throws: metering must not break the user's request. */
export async function logUsage(entry: UsageEntry): Promise<void> {
  try {
    await db.usageLog.create({ data: entry });
  } catch (err) {
    logger.error("usage.log_failed", { kind: entry.kind, userId: entry.userId, err });
  }
}

/** Sliding-window limit on usage_logs rows (counts failed attempts too, to stop hammering). */
/**
 * A budget, keyed by whoever is spending it.
 *
 * A signed-in user is counted by id. A visitor is counted by a salted hash of their address,
 * which is what makes the football pages safe to open up: the provider quota behind them is a
 * few hundred requests a minute shared by everybody, and "no account required" cannot be allowed
 * to mean "no limit". The raw address is never stored.
 *
 * Neither one present means there is nobody to bill - a server-side job, or a request with no
 * usable address header - and the caller is responsible for its own bounds.
 */
export async function enforceRateLimit(opts: {
  userId?: string | null;
  ipHash?: string | null;
  kind: UsageKind;
  limit: number;
  windowMs: number;
}) {
  const who = opts.userId ? { userId: opts.userId } : opts.ipHash ? { ipHash: opts.ipHash } : null;
  if (!who) return;
  const since = new Date(Date.now() - opts.windowMs);
  const count = await db.usageLog.count({
    where: { ...who, kind: opts.kind, createdAt: { gte: since } },
  });
  if (count >= opts.limit) {
    const minutes = Math.round(opts.windowMs / 60_000);
    throw new AppError("RATE_LIMITED", `You've reached the limit of ${opts.limit} per ${minutes} minutes. Please wait a bit and try again.`);
  }
}
