import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getActiveSubscription } from "@/lib/services/profile";

// Per-feature daily limits, read from the plans table so prices and limits change without a deploy.
// Users without a subscription fall back to the "free" plan row.

export type Feature = "chat" | "upload" | "build" | "analysis";

export type AiAllowance = {
  plan: { code: string; name: string } | null;
  allowDeepAnalysis: boolean;
  allowDailyPicks: boolean;
  /** Chat messages left today (or trial credits when on the free plan). */
  remaining: number;
  kind: "plan" | "trial";
  tokensUsedToday: number;
  dailyTokenLimit: number | null;
  /** What's left today for each feature; null means unlimited. */
  features: Record<Feature, { used: number; limit: number | null; remaining: number | null }>;
};

type PlanLimits = {
  code: string;
  name: string;
  dailyAiRequests: number;
  dailyTokenLimit: number;
  allowDeepAnalysis: boolean;
  allowDailyPicks: boolean;
  dailyUploads: number;
  dailySlipBuilds: number;
  dailyAnalyses: number;
};

/** Ghana runs on GMT all year, so the UTC day is the local day. */
function startOfDayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const FREE_FALLBACK: PlanLimits = {
  code: "free",
  name: "Free",
  dailyAiRequests: 3,
  dailyTokenLimit: 20_000,
  allowDeepAnalysis: false,
  allowDailyPicks: false,
  dailyUploads: 1,
  dailySlipBuilds: 1,
  dailyAnalyses: 0,
};

async function planFor(userId: string): Promise<{ limits: PlanLimits; subscribed: boolean }> {
  const subscription = await getActiveSubscription(userId);
  if (subscription) return { limits: subscription.plan as PlanLimits, subscribed: true };
  const free = await db.plan.findUnique({ where: { code: "free" } });
  return { limits: (free as PlanLimits | null) ?? FREE_FALLBACK, subscribed: false };
}

/** How many times each feature has been used today. */
async function usageToday(userId: string) {
  const since = startOfDayUtc();
  const rows = await db.usageLog.groupBy({
    by: ["kind"],
    where: { userId, success: true, createdAt: { gte: since } },
    _count: true,
    _sum: { inputTokens: true, outputTokens: true },
  });
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const meta = await db.usageLog.findMany({
    where: { userId, success: true, kind: "AI_CHAT", createdAt: { gte: since } },
    select: { meta: true },
  });
  const uploads = meta.filter((m) => (m.meta as { op?: string } | null)?.op === "extract").length;
  const builds = await db.usageLog.count({
    where: { userId, success: true, kind: "SLIP_EDIT", createdAt: { gte: since }, meta: { path: ["op"], equals: "target" } },
  });

  const chatRows = byKind.get("AI_CHAT");
  return {
    chat: Math.max(0, (chatRows?._count ?? 0) - uploads), // a screenshot read isn't a chat message
    upload: uploads,
    build: builds,
    analysis: byKind.get("AI_ANALYSIS")?._count ?? 0,
    tokens: rows.reduce((sum, r) => sum + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0),
  };
}

export async function getAiAllowance(userId: string): Promise<AiAllowance> {
  const [{ limits, subscribed }, used] = await Promise.all([planFor(userId), usageToday(userId)]);

  const limitOf = (n: number) => (n < 0 ? null : n);
  const left = (limit: number | null, usedCount: number) => (limit === null ? null : Math.max(0, limit - usedCount));

  const chatLimit = limitOf(limits.dailyAiRequests);
  // A daily token ceiling backstops the per-feature counts against unusually long conversations.
  const overTokens = used.tokens >= limits.dailyTokenLimit;
  const chatLeft = overTokens ? 0 : (left(chatLimit, used.chat) ?? Number.MAX_SAFE_INTEGER);

  return {
    plan: subscribed ? { code: limits.code, name: limits.name } : null,
    allowDeepAnalysis: limits.allowDeepAnalysis,
    allowDailyPicks: limits.allowDailyPicks,
    kind: subscribed ? "plan" : "trial",
    remaining: chatLeft,
    tokensUsedToday: used.tokens,
    dailyTokenLimit: limits.dailyTokenLimit,
    features: {
      // The token ceiling applies to chat, so an unusually long conversation can't slip past the count.
      chat: { used: used.chat, limit: chatLimit, remaining: overTokens ? 0 : left(chatLimit, used.chat) },
      upload: { used: used.upload, limit: limitOf(limits.dailyUploads), remaining: left(limitOf(limits.dailyUploads), used.upload) },
      build: { used: used.build, limit: limitOf(limits.dailySlipBuilds), remaining: left(limitOf(limits.dailySlipBuilds), used.build) },
      analysis: { used: used.analysis, limit: limitOf(limits.dailyAnalyses), remaining: left(limitOf(limits.dailyAnalyses), used.analysis) },
    },
  };
}

const FEATURE_NAMES: Record<Feature, string> = {
  chat: "chat messages",
  upload: "screenshot reads",
  build: "slip builds",
  analysis: "match analyses",
};

/** Throws with a clear, upgradeable message when the feature's daily limit is used up. */
export async function requireFeature(userId: string, feature: Feature): Promise<AiAllowance> {
  const allowance = await getAiAllowance(userId);
  const state = allowance.features[feature];

  if (feature === "analysis" && !allowance.allowDeepAnalysis) {
    throw new AppError("PLAN_LIMIT_REACHED", "Match analysis is part of the Pro and VIP plans.");
  }
  if (state.limit === 0) {
    throw new AppError("PLAN_LIMIT_REACHED", `${FEATURE_NAMES[feature][0].toUpperCase()}${FEATURE_NAMES[feature].slice(1)} aren't part of your plan yet.`);
  }
  if (feature === "chat" && state.remaining === 0 && allowance.tokensUsedToday >= (allowance.dailyTokenLimit ?? Infinity)) {
    throw new AppError("PLAN_LIMIT_REACHED", "You've used today's AI allowance on this plan. It resets at midnight (GMT).");
  }
  if (state.remaining !== null && state.remaining <= 0) {
    throw new AppError(
      "PLAN_LIMIT_REACHED",
      allowance.kind === "trial"
        ? `You've used today's free ${FEATURE_NAMES[feature]}. They reset at midnight (GMT), or pick a plan for more.`
        : `You've used today's ${FEATURE_NAMES[feature]} on the ${allowance.plan?.name} plan. They reset at midnight (GMT).`,
    );
  }
  return allowance;
}

/** Kept for the chat path: the same check, named for what it does there. */
export async function requireAiAllowance(userId: string): Promise<AiAllowance> {
  return requireFeature(userId, "chat");
}


