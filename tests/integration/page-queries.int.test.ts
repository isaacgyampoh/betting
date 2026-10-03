import { beforeAll, describe, expect, it } from "vitest";
import { db, queryCounter } from "@/lib/db";
import { getProfile } from "@/lib/auth";
import { getAiAllowance } from "@/lib/services/ai-quota";
import { getActiveSubscription } from "@/lib/services/profile";
import { forgetPlans } from "@/lib/services/plans";
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

  // It is an upsert rather than a read on purpose: Hyperdrive serves plain SELECTs from a cache it
  // does not invalidate on writes, and a stale profile here locked people out behind the 18+ page.
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
