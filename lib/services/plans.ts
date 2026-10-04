import "server-only";
import { db } from "@/lib/db";
import type { PlanModel } from "@/lib/generated/prisma/models";

/** Plan codes follow `<tier>_<period>` (e.g. pro_week); `free` has neither. */
export type PlanPeriod = "day" | "week" | "month";

export type PlanView = {
  code: string;
  /** "free" | "starter" | "pro" | "vip" */
  tier: string;
  period: PlanPeriod | null;
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
  return plans.map((p) => {
    const [tier, period] = p.code.split("_");
    return {
    code: p.code,
    tier,
    period: (period as PlanPeriod | undefined) ?? null,
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
    };
  });
}

/**
 * The plans table, held for a minute at a time.
 *
 * Every protected page needs the signed-in user's plan limits before it can render, and on Workers
 * each query is a hop to the database in another region. There are ten rows, the same for everyone,
 * and they change only when someone edits pricing - so re-reading them per request buys nothing. A
 * worker isolate is short-lived anyway; the most anyone sees of an edit is a minute's delay.
 */
const PLANS_TTL_MS = 60_000;

let cachedPlans: { at: number; plans: PlanModel[] } | null = null;

/** Drops the cache. For tests, and for anything that edits the plans table and reads it back. */
export function forgetPlans() {
  cachedPlans = null;
  verifiedAt = 0;
}

async function allPlans(): Promise<PlanModel[]> {
  if (cachedPlans && Date.now() - cachedPlans.at < PLANS_TTL_MS) return cachedPlans.plans;
  const plans = await db.plan.findMany();
  cachedPlans = { at: Date.now(), plans };
  return plans;
}

/**
 * A miss is checked against the table before it is believed.
 *
 * Someone's subscription points at a plan, so a plan this does not know about means the cache is
 * older than the row - a plan added in the last minute. Treating that as "no plan" would put a
 * paying user on the free limits until the cache turned over, which is the one case where being a
 * minute stale actually costs something.
 */
/** The newest snapshot already re-read because of a miss, so one snapshot is never re-read twice. */
let verifiedAt = 0;

async function find(match: (p: PlanModel) => boolean): Promise<PlanModel | null> {
  const hit = (await allPlans()).find(match);
  if (hit) return hit;
  // A plan that genuinely does not exist must not re-read the table on every request, so the
  // second look happens once per cache window rather than once per miss.
  if ((cachedPlans?.at ?? 0) <= verifiedAt) return null;
  cachedPlans = null;
  const fresh = await allPlans();
  verifiedAt = cachedPlans?.at ?? Date.now();
  return fresh.find(match) ?? null;
}

export async function planById(id: string): Promise<PlanModel | null> {
  return find((p) => p.id === id);
}

export async function planByCode(code: string): Promise<PlanModel | null> {
  return find((p) => p.code === code);
}

/** The plan an admin is granted: any active VIP row carries the VIP limits. */
export async function topVipPlan(): Promise<PlanModel | null> {
  const vip = (await allPlans()).filter((p) => p.code.startsWith("vip") && p.isActive);
  return vip.sort((a, b) => b.durationDays - a.durationDays)[0] ?? null;
}
