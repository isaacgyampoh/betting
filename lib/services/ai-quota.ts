import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getActiveSubscription } from "@/lib/services/profile";
import { planByCode } from "@/lib/services/plans";
import type { UserRole } from "@/lib/generated/prisma/enums";

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

async function planFor(userId: string, knownRole?: UserRole): Promise<{ limits: PlanLimits; subscribed: boolean }> {
  const subscription = await getActiveSubscription(userId, knownRole);
  if (subscription) return { limits: subscription.plan as PlanLimits, subscribed: true };
  const free = (await planByCode("free")) as PlanLimits | null;
  return { limits: free ?? FREE_FALLBACK, subscribed: false };
}

/**
 * How many times each feature has been used today, in one round trip.
 *
 * This runs before every protected page renders, and on Workers each query is a hop to the
 * database through Hyperdrive, so the count of queries is what the user feels. The three Prisma
 * calls this replaced - a groupBy, a findMany to spot screenshot reads, and a filtered count for
 * builds - all read the same rows for the same day, and Postgres will do the whole lot in one
 * aggregate over the (user_id, kind, created_at) index.
 */
async function usageToday(userId: string) {
  const [row] = await db.$queryRaw<
    { chat_all: bigint; uploads: bigint; builds: bigint; analyses: bigint; tokens: bigint }[]
  >`
    select
      count(*) filter (where kind = 'AI_CHAT')                                     as chat_all,
      count(*) filter (where kind = 'AI_CHAT' and meta->>'op' = 'extract')         as uploads,
      count(*) filter (where kind = 'SLIP_EDIT' and meta->>'op' = 'target')        as builds,
      count(*) filter (where kind = 'AI_ANALYSIS')                                 as analyses,
      coalesce(sum(input_tokens + output_tokens), 0)                               as tokens
    from usage_logs
    where user_id = ${userId}::uuid and success and created_at >= ${startOfDayUtc()}
  `;

  const n = (value: bigint | number | null | undefined) => Number(value ?? 0);
  const uploads = n(row?.uploads);
  return {
    chat: Math.max(0, n(row?.chat_all) - uploads), // a screenshot read isn't a chat message
    upload: uploads,
    build: n(row?.builds),
    analysis: n(row?.analyses),
    tokens: n(row?.tokens),
  };
}

/** `knownRole` saves a lookup when the caller is already holding the profile. */
export async function getAiAllowance(userId: string, knownRole?: UserRole): Promise<AiAllowance> {
  const [{ limits, subscribed }, used] = await Promise.all([planFor(userId, knownRole), usageToday(userId)]);

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


