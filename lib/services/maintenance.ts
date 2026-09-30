import "server-only";
import { db } from "@/lib/db";

const DAY = 86_400_000;

/** Prunes expired caches and old metering rows so the free database tier doesn't fill up. */
export async function cleanup(now = new Date()) {
  const [codeCache, statsCache, usageLogs, pendingPayments] = await Promise.all([
    db.codeCache.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } }),
    db.statsCache.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } } }),
    db.usageLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY) } } }),
    db.payment.updateMany({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 2 * DAY) } }, data: { status: "ABANDONED" } }),
  ]);
  return { codeCache: codeCache.count, statsCache: statsCache.count, usageLogs: usageLogs.count, abandonedPayments: pendingPayments.count };
}
