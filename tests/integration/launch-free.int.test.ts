import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAiAllowance, requireFeature } from "@/lib/services/ai-quota";
import { canSeePicks } from "@/lib/services/daily-picks";
import { LAUNCH } from "@/lib/launch";
import { createUser } from "./helpers";

/**
 * The other side of the paid-regime suites: with the giveaway on (its real state), an ordinary
 * signed-in user must actually be able to use the product. Hiding a payment button while the API
 * keeps refusing is the failure this is here to catch.
 */
describe("while everything is free", () => {
  async function useFeature(userId: string, feature: "chat" | "upload" | "build" | "analysis", n: number) {
    const rows = Array.from({ length: n }, () => {
      if (feature === "upload") return { userId, kind: "AI_CHAT" as const, success: true, meta: { op: "extract" } };
      if (feature === "build") return { userId, kind: "SLIP_EDIT" as const, success: true, meta: { op: "target" } };
      if (feature === "analysis") return { userId, kind: "AI_ANALYSIS" as const, success: true };
      return { userId, kind: "AI_CHAT" as const, success: true };
    });
    await db.usageLog.createMany({ data: rows });
  }

  it("gives a user with no subscription every feature", async () => {
    const user = await createUser();
    const allowance = await getAiAllowance(user.id);

    expect(allowance.allowDeepAnalysis).toBe(true);
    expect(allowance.allowDailyPicks).toBe(true);
    expect(allowance.features.chat.limit).toBe(LAUNCH.limits.dailyAiRequests);
    expect(allowance.features.analysis.limit).toBe(LAUNCH.limits.dailyAnalyses);
    expect(allowance.features.upload.limit).toBe(LAUNCH.limits.dailyUploads);
    expect(allowance.features.build.limit).toBe(LAUNCH.limits.dailySlipBuilds);
  });

  // The whole point: not just a hidden paywall button, but an API that actually answers.
  it("lets an ordinary user actually use chat, builds, uploads and analysis", async () => {
    const user = await createUser();
    await expect(requireFeature(user.id, "chat")).resolves.toBeDefined();
    await expect(requireFeature(user.id, "build")).resolves.toBeDefined();
    await expect(requireFeature(user.id, "upload")).resolves.toBeDefined();
    await expect(requireFeature(user.id, "analysis")).resolves.toBeDefined();
  });

  it("shows daily picks to anyone signed in, and still nothing to a visitor", async () => {
    const user = await createUser();
    expect(await canSeePicks(user.id)).toBe(true);
    expect(await canSeePicks(null)).toBe(false);
  });

  // Free is not unlimited. Behind chat is Anthropic's bill and API-Football's quota, and the
  // ceiling is what stops one afternoon taking the football data down for everybody.
  it("still stops at the daily ceiling", async () => {
    const user = await createUser();
    await useFeature(user.id, "chat", LAUNCH.limits.dailyAiRequests);

    await expect(requireFeature(user.id, "chat")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
  });

  it("does not sell a plan in the message, because none is being sold", async () => {
    const user = await createUser();
    await useFeature(user.id, "build", LAUNCH.limits.dailySlipBuilds);

    await requireFeature(user.id, "build").then(
      () => expect.unreachable("should have been refused"),
      (err: { message: string }) => {
        expect(err.message).toContain("reset at midnight");
        expect(err.message).not.toMatch(/plan|upgrade|pro|vip/i);
      },
    );
  });

  it("never makes a paying subscriber worse off", async () => {
    const user = await createUser();
    const plan = await db.plan.findFirst({ where: { dailyAiRequests: { gt: LAUNCH.limits.dailyAiRequests } } });
    if (!plan) return; // no plan is more generous than launch; nothing to prove
    await db.subscription.create({
      data: { userId: user.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000) },
    });

    const allowance = await getAiAllowance(user.id);
    expect(allowance.features.chat.limit).toBe(plan.dailyAiRequests);
    expect(allowance.plan?.code).toBe(plan.code);
  });
});
