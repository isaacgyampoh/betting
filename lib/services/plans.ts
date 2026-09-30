import "server-only";
import { db } from "@/lib/db";

export async function listActivePlans() {
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    description: p.description,
    priceGhs: p.pricePesewas / 100,
    currency: p.currency,
    durationDays: p.durationDays,
    dailyAiRequests: p.dailyAiRequests,
    allowDeepAnalysis: p.allowDeepAnalysis,
  }));
}
