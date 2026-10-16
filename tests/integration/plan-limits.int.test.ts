import { describe, expect, it, vi} from "vitest";
import { db } from "@/lib/db";
import { getAiAllowance, requireFeature } from "@/lib/services/ai-quota";
import { canSeePicks } from "@/lib/services/daily-picks";
import { startCheckout } from "@/lib/services/billing";
import { createUser } from "./helpers";

// These cover the paid regime: per-plan daily limits, locked features, upgrade wording. Launch is
// currently giving all of it away (lib/launch.ts), so the giveaway is switched off here rather
// than letting it quietly hide whether any of this still works. tests/services/launch-free.test.ts
// and the "while everything is free" cases below cover the other side.
vi.mock("@/lib/launch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/launch")>();
  return { ...actual, everythingIsFree: () => false };
});


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
    // Free plus three tiers, each buyable by day, week or month.
    expect(plans.map((p) => p.code)).toEqual([
      "free",
      "starter_day", "starter_week", "starter_month",
      "pro_day", "pro_week", "pro_month",
      "vip_day", "vip_week", "vip_month",
    ]);
    const price = (c: string) => plans.find((p) => p.code === c)!.pricePesewas;
    expect([price("starter_day"), price("starter_week"), price("starter_month")]).toEqual([500, 2000, 6000]);
    expect([price("pro_day"), price("pro_week"), price("pro_month")]).toEqual([1000, 4000, 12000]);
    expect([price("vip_day"), price("vip_week"), price("vip_month")]).toEqual([1500, 7000, 20000]);

    // A tier's limits are identical whichever duration you buy.
    for (const tier of ["starter", "pro", "vip"]) {
      const rows = plans.filter((p) => p.code.startsWith(`${tier}_`));
      expect(new Set(rows.map((r) => r.dailyAiRequests)).size).toBe(1);
      expect(new Set(rows.map((r) => r.dailyUploads)).size).toBe(1);
    }
    // Limits rise with the tier, and longer durations cost less per day.
    const chats = (t: string) => plans.find((p) => p.code === `${t}_day`)!.dailyAiRequests;
    expect(chats("starter")).toBeLessThan(chats("pro"));
    expect(chats("pro")).toBeLessThan(chats("vip"));
    expect(price("vip_month") / 30).toBeLessThan(price("vip_day"));

    // Only Pro and VIP include analysis and the daily picks.
    expect(new Set(plans.filter((p) => p.allowDeepAnalysis).map((p) => p.code.split("_")[0]))).toEqual(new Set(["pro", "vip"]));
    expect(new Set(plans.filter((p) => p.allowDailyPicks).map((p) => p.code.split("_")[0]))).toEqual(new Set(["pro", "vip"]));
  });

  it("a user with no subscription gets the free plan's limits", async () => {
    const user = await createUser();
    const allowance = await getAiAllowance(user.id);
    expect(allowance).toMatchObject({ kind: "trial", plan: null, allowDeepAnalysis: false, allowDailyPicks: false });
    expect(allowance.features.chat.limit).toBe(3);
    expect(allowance.features.analysis.limit).toBe(0);
  });

  it("each feature has its own daily count", async () => {
    const { user } = await subscribe("pro_week");
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
    const { user } = await subscribe("starter_day");
    await useFeature(user.id, "upload", 3); // starter allows 3

    await expect(requireFeature(user.id, "upload")).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: expect.stringContaining("Starter"),
    });
    // other features are unaffected
    await expect(requireFeature(user.id, "chat")).resolves.toBeTruthy();
  });

  it("analysis is refused on plans without it, whatever the count", async () => {
    const { user } = await subscribe("starter_day");
    await expect(requireFeature(user.id, "analysis")).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      message: expect.stringContaining("Pro and VIP"),
    });
  });

  it("VIP has a high but finite build allowance", async () => {
    const { user } = await subscribe("vip_month");
    await useFeature(user.id, "build", 50);
    const a = await getAiAllowance(user.id);
    // VIP builds are a high finite number, not unlimited: unbounded cost can't be priced.
    expect(a.features.build.limit).toBe(30);
    await expect(requireFeature(user.id, "build")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
  });

  it("daily picks follow the plan flag", async () => {
    const free = await createUser();
    expect(await canSeePicks(free.id)).toBe(false);
    expect(await canSeePicks((await subscribe("starter_day")).user.id)).toBe(false);
    expect(await canSeePicks((await subscribe("pro_week")).user.id)).toBe(true);
    expect(await canSeePicks((await subscribe("vip_month")).user.id)).toBe(true);
  });

  it("the free plan can't be bought", async () => {
    const user = await createUser();
    await expect(startCheckout(user, "free")).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("free") });
  });

  it("a daily token ceiling backstops unusually long conversations", async () => {
    const { user, plan } = await subscribe("starter_day");
    await db.usageLog.create({ data: { userId: user.id, kind: "AI_CHAT", success: true, inputTokens: plan.dailyTokenLimit, outputTokens: 0 } });
    expect((await getAiAllowance(user.id)).remaining).toBe(0);
    await expect(requireFeature(user.id, "chat")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
  });
});
