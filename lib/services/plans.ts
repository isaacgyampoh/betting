import "server-only";
import { db } from "@/lib/db";

export type PlanView = {
  code: string;
  name: string;
  description: string | null;
  priceGhs: number;
  currency: string;
  durationDays: number;
  dailyAiRequests: number;
  dailyUploads: number;
  dailySlipBuilds: number;
  dailyAnalyses: number;
  allowDeepAnalysis: boolean;
  allowDailyPicks: boolean;
};

export async function listActivePlans(): Promise<PlanView[]> {
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    description: p.description,
    priceGhs: p.pricePesewas / 100,
    currency: p.currency,
    durationDays: p.durationDays,
    dailyAiRequests: p.dailyAiRequests,
    dailyUploads: p.dailyUploads,
    dailySlipBuilds: p.dailySlipBuilds,
    dailyAnalyses: p.dailyAnalyses,
    allowDeepAnalysis: p.allowDeepAnalysis,
    allowDailyPicks: p.allowDailyPicks,
  }));
}
