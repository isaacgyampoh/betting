import { beforeAll, describe, expect, it } from "vitest";
import { db, queryCounter } from "@/lib/db";
import { getProfile } from "@/lib/auth";
import { getAiAllowance } from "@/lib/services/ai-quota";
import { getActiveSubscription } from "@/lib/services/profile";
import { forgetPlans, planByCode } from "@/lib/services/plans";
import { createUser } from "./helpers";

// On Workers a query is a round trip to the database before anything renders, and every protected
// page waits on this work before its first byte. The count is the thing the user feels, so it is
// asserted rather than hoped for. Run with DB_QUERY_LOG=1 (vitest.integration.config.mts sets it).

async function queries(fn: () => Promise<unknown>) {
  const before = queryCounter.count;
  await fn();
  return queryCounter.count - before;
}

describe("queries a protected page makes", () => {
  beforeAll(() => {
    expect(process.env.DB_QUERY_LOG, "set DB_QUERY_LOG=1 or this test proves nothing").toBe("1");
  });

  it("loads the profile in one query", async () => {
    const user = await createUser();
    expect(await queries(() => getProfile({ id: user.id, email: user.email }))).toBe(1);
  });

  // It is a write rather than a read on purpose; lib/auth.ts says what happened when it was not.
  it("sees a write to the profile immediately", async () => {
    const user = await createUser();
    await db.profile.update({ where: { id: user.id }, data: { displayName: "Kofi" } });
    expect((await getProfile({ id: user.id, email: user.email })).displayName).toBe("Kofi");
  });

  it("returns every column, typed as the model", async () => {
    const user = await createUser();
    await db.profile.update({
      where: { id: user.id },
      data: { displayName: "Ama", role: "ADMIN", freeAiCredits: 2, remindersOn: true, spendNotePesewas: 5000 },
    });
    const profile = await getProfile({ id: user.id, email: user.email });
    const direct = await db.profile.findUniqueOrThrow({ where: { id: user.id } });
    expect(profile).toEqual(direct);
  });

  it("still creates a profile when there is none", async () => {
    const id = crypto.randomUUID();
    await db.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${`${id}@example.com`})`;
    await db.profile.delete({ where: { id } }).catch(() => {});
    const profile = await getProfile({ id, email: `${id}@example.com` });
    expect(profile.id).toBe(id);
  });

  it("gets the role and the subscription in one query", async () => {
    const user = await createUser();
    await getActiveSubscription(user.id); // warm the plans cache
    expect(await queries(() => getActiveSubscription(user.id))).toBe(1);
  });

  it("reads the plans table once a minute, not once a page", async () => {
    const user = await createUser();
    const plan = await db.plan.findUniqueOrThrow({ where: { code: "pro_week" } });
    await db.subscription.create({
      data: { userId: user.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000) },
    });

    forgetPlans();
    const cold = await queries(() => getActiveSubscription(user.id));
    const warm = await queries(() => getActiveSubscription(user.id));
    expect(warm).toBe(1); // the subscription, and nothing else
    expect(cold).toBe(warm + 1); // plus the one read of the plans table

    const sub = await getActiveSubscription(user.id);
    expect(sub?.plan.code).toBe("pro_week");
  });

  // A paying user whose plan was created a minute ago must not read as having no plan: the
  // subscription points at it, so a plan the cache has never heard of means the cache is stale.
  it("looks again when a subscription points at a plan the cache has not seen", async () => {
    const user = await createUser();
    await getActiveSubscription(user.id); // fill the cache with the plans that exist now
    const code = `brand_new_${Date.now()}`;
    // Whatever this asserts, the plans table has to be left exactly as it was found: another test
    // in this suite checks the full list of plan codes, and a row left behind fails it instead.
    try {
      const plan = await db.plan.create({
        data: {
          code,
          name: "Brand New",
          pricePesewas: 1000,
          durationDays: 1,
          dailyAiRequests: 5,
          dailyTokenLimit: 50_000,
          dailyUploads: 1,
          dailySlipBuilds: 1,
          dailyAnalyses: 0,
        },
      });
      await db.subscription.create({
        data: { userId: user.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000) },
      });

      expect((await getActiveSubscription(user.id))?.plan.code).toBe(code);

      // A plan that really is not there costs the second look once, not once per request.
      forgetPlans();
      await planByCode("no_such_plan_at_all");
      expect(await queries(() => planByCode("no_such_plan_at_all"))).toBe(0);
    } finally {
      await db.subscription.deleteMany({ where: { plan: { code } } });
      await db.plan.deleteMany({ where: { code: { startsWith: "brand_new_" } } });
      forgetPlans();
    }
  });

  it("counts a day's usage of every feature in one query", async () => {
    const user = await createUser();
    await db.usageLog.createMany({
      data: [
        { userId: user.id, kind: "AI_CHAT", inputTokens: 10, outputTokens: 5 },
        { userId: user.id, kind: "AI_CHAT", meta: { op: "extract" }, inputTokens: 1, outputTokens: 1 },
        { userId: user.id, kind: "SLIP_EDIT", meta: { op: "target" } },
        { userId: user.id, kind: "AI_ANALYSIS" },
        { userId: user.id, kind: "AI_CHAT", success: false, inputTokens: 999, outputTokens: 999 },
      ],
    });

    // Two queries: the plan (role + subscription) and the day's usage, and they run together.
    await getAiAllowance(user.id); // warm the plans cache
    expect(await queries(() => getAiAllowance(user.id))).toBe(2);

    const a = await getAiAllowance(user.id);
    expect(a.features.chat.used).toBe(1); // the screenshot read is not a chat message
    expect(a.features.upload.used).toBe(1);
    expect(a.features.build.used).toBe(1);
    expect(a.features.analysis.used).toBe(1);
    expect(a.tokensUsedToday).toBe(17); // the failed call is not charged
  });

  it("costs the same whether or not the caller already holds the role", async () => {
    const user = await createUser();
    const profile = await db.profile.findUniqueOrThrow({ where: { id: user.id } });
    await getAiAllowance(user.id, profile.role); // warm the plans cache
    expect(await queries(() => getAiAllowance(user.id, profile.role))).toBe(2);
    expect(await queries(() => getActiveSubscription(user.id, profile.role))).toBe(1);
  });

  it("does not count yesterday's usage against today", async () => {
    const user = await createUser();
    await db.usageLog.create({
      data: { userId: user.id, kind: "AI_CHAT", createdAt: new Date(Date.now() - 36 * 3_600_000), inputTokens: 100 },
    });
    const a = await getAiAllowance(user.id);
    expect(a.features.chat.used).toBe(0);
    expect(a.tokensUsedToday).toBe(0);
  });
});
