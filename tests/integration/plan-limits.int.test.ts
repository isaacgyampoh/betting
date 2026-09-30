import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAiAllowance, requireFeature } from "@/lib/services/ai-quota";
import { canSeePicks } from "@/lib/services/daily-picks";
import { startCheckout } from "@/lib/services/billing";
import { createUser } from "./helpers";

async function subscribe(code: string) {
  const user = await createUser();
  const plan = await db.plan.findUniqueOrThrow({ where: { code } });
  await db.subscription.create({
    data: { userId: user.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + plan.durationDays * 86_400_000) },
  });
  return { user, plan };
}

/** Records n successful uses of a feature, the same way the services do. */
async function useFeature(userId: string, feature: "chat" | "upload" | "build" | "analysis", n: number) {
  const rows = Array.from({ length: n }, () => {
    if (feature === "upload") return { userId, kind: "AI_CHAT" as const, success: true, meta: { op: "extract" } };
    if (feature === "build") return { userId, kind: "SLIP_EDIT" as const, success: true, meta: { op: "target" } };
    if (feature === "analysis") return { userId, kind: "AI_ANALYSIS" as const, success: true };
    return { userId, kind: "AI_CHAT" as const, success: true };
  });
  await db.usageLog.createMany({ data: rows });
}

describe("plan tiers", () => {
  it("the four tiers exist with rising limits", async () => {
    const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    expect(plans.map((p) => p.code)).toEqual(["free", "starter", "pro", "vip"]);
    expect(plans.map((p) => p.pricePesewas)).toEqual([0, 1000, 4500, 12000]);
    // limits never go down as you pay more
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].dailyAiRequests).toBeGreaterThan(plans[i - 1].dailyAiRequests);
      expect(plans[i].dailyUploads).toBeGreaterThanOrEqual(plans[i - 1].dailyUploads);
    }
    // only the paid week and month include analysis and picks
    expect(plans.filter((p) => p.allowDeepAnalysis).map((p) => p.code)).toEqual(["pro", "vip"]);
    expect(plans.filter((p) => p.allowDailyPicks).map((p) => p.code)).toEqual(["pro", "vip"]);
  });

  it("a user with no subscription gets the free plan's limits", async () => {
    const user = await createUser();
    const allowance = await getAiAllowance(user.id);
    expect(allowance).toMatchObject({ kind: "trial", plan: null, allowDeepAnalysis: false, allowDailyPicks: false });
    expect(allowance.features.chat.limit).toBe(3);
    expect(allowance.features.analysis.limit).toBe(0);
  });

  it("each feature has its own daily count", async () => {
    const { user } = await subscribe("pro");
    await useFeature(user.id, "chat", 5);
    await useFeature(user.id, "upload", 2);
    await useFeature(user.id, "build", 1);

    const a = await getAiAllowance(user.id);
    // uploads are logged as AI_CHAT rows, but must not be counted as chat messages
    expect(a.features.chat).toMatchObject({ used: 5, limit: 40, remaining: 35 });
    expect(a.features.upload).toMatchObject({ used: 2, limit: 10, remaining: 8 });
    expect(a.features.build).toMatchObject({ used: 1, limit: 10, remaining: 9 });
    expect(a.features.analysis).toMatchObject({ used: 0, limit: 3 });
  });

  it("blocks a feature once its daily limit is reached, with an upgrade hint", async () => {
    const { user } = await subscribe("starter");
    await useFeature(user.id, "upload", 3); // starter allows 3

    await expect(requireFeature(user.id, "upload")).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: expect.stringContaining("Starter"),
    });
    // other features are unaffected
    await expect(requireFeature(user.id, "chat")).resolves.toBeTruthy();
  });

  it("analysis is refused on plans without it, whatever the count", async () => {
    const { user } = await subscribe("starter");
    await expect(requireFeature(user.id, "analysis")).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: expect.stringContaining("Pro and VIP"),
    });
  });

  it("VIP treats -1 as unlimited", async () => {
    const { user } = await subscribe("vip");
    await useFeature(user.id, "build", 50);
    const a = await getAiAllowance(user.id);
    expect(a.features.build).toMatchObject({ limit: null, remaining: null });
    await expect(requireFeature(user.id, "build")).resolves.toBeTruthy();
  });

  it("daily picks follow the plan flag", async () => {
    const free = await createUser();
    expect(await canSeePicks(free.id)).toBe(false);
    expect(await canSeePicks((await subscribe("starter")).user.id)).toBe(false);
    expect(await canSeePicks((await subscribe("pro")).user.id)).toBe(true);
    expect(await canSeePicks((await subscribe("vip")).user.id)).toBe(true);
  });

  it("the free plan can't be bought", async () => {
    const user = await createUser();
    await expect(startCheckout(user, "free")).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("free") });
  });

  it("a daily token ceiling backstops unusually long conversations", async () => {
    const { user, plan } = await subscribe("starter");
    await db.usageLog.create({ data: { userId: user.id, kind: "AI_CHAT", success: true, inputTokens: plan.dailyTokenLimit, outputTokens: 0 } });
    expect((await getAiAllowance(user.id)).remaining).toBe(0);
    await expect(requireFeature(user.id, "chat")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
  });
});
