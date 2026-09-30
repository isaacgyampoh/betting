import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getActiveSubscription } from "@/lib/services/profile";

export type AiAllowance = {
  plan: { code: string; name: string } | null;
  allowDeepAnalysis: boolean;
  /** Requests left today (plan) or trial credits left (no plan). */
  remaining: number;
  kind: "plan" | "trial";
  tokensUsedToday: number;
  dailyTokenLimit: number | null;
};

function startOfDayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0); // Ghana is GMT year-round
  return d;
}

export async function getAiAllowance(userId: string): Promise<AiAllowance> {
  const [subscription, profile, today] = await Promise.all([
    getActiveSubscription(userId),
    db.profile.findUnique({ where: { id: userId }, select: { freeAiCredits: true } }),
    db.usageLog.aggregate({
      where: { userId, kind: { in: ["AI_CHAT", "AI_ANALYSIS"] }, success: true, createdAt: { gte: startOfDayUtc() } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const tokensUsedToday = (today._sum.inputTokens ?? 0) + (today._sum.outputTokens ?? 0);
  const chatRequestsToday = await db.usageLog.count({
    where: { userId, kind: "AI_CHAT", success: true, createdAt: { gte: startOfDayUtc() } },
  });

  if (subscription) {
    const plan = subscription.plan;
    const byRequests = plan.dailyAiRequests - chatRequestsToday;
    const byTokens = tokensUsedToday >= plan.dailyTokenLimit ? 0 : byRequests;
    return {
      plan: { code: plan.code, name: plan.name },
      allowDeepAnalysis: plan.allowDeepAnalysis,
      remaining: Math.max(0, Math.min(byRequests, byTokens)),
      kind: "plan",
      tokensUsedToday,
      dailyTokenLimit: plan.dailyTokenLimit,
    };
  }
  return {
    plan: null,
    allowDeepAnalysis: false,
    remaining: Math.max(0, profile?.freeAiCredits ?? 0),
    kind: "trial",
    tokensUsedToday,
    dailyTokenLimit: null,
  };
}

export async function requireAiAllowance(userId: string): Promise<AiAllowance> {
  const a = await getAiAllowance(userId);
  if (a.remaining <= 0) {
    throw new AppError(
      "PLAN_LIMIT_REACHED",
      a.kind === "trial"
        ? "You've used your free AI requests. Get a plan to keep chatting. Slip tools stay free."
        : "You've reached today's AI limit for your plan. It resets at midnight (GMT).",
    );
  }
  return a;
}

/** Consumes one trial credit (no-op for plan users; their usage is counted from usage_logs). */
export async function consumeTrialCredit(userId: string, allowance: AiAllowance) {
  if (allowance.kind !== "trial") return;
  await db.profile.updateMany({ where: { id: userId, freeAiCredits: { gt: 0 } }, data: { freeAiCredits: { decrement: 1 } } });
}
