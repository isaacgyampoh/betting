import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getActiveSubscription, getMe } from "@/lib/services/profile";
import { getAiAllowance } from "@/lib/services/ai-quota";
import { canSeePicks } from "@/lib/services/daily-picks";
import { createUser } from "./helpers";

// The operator needs every feature on the live site without paying themselves. That is a standing
// grant of a paid tier, so these pin down that it reaches the admin and nobody else.

async function makeAdmin() {
  const user = await createUser();
  await db.profile.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  return user;
}

describe("admin access", () => {
  it("gives an admin the VIP tier with no subscription row", async () => {
    const admin = await makeAdmin();
    const sub = await getActiveSubscription(admin.id);
    expect(sub?.plan.code).toMatch(/^vip/);
    expect(sub?.plan.allowDeepAnalysis).toBe(true);
    expect(sub?.plan.allowDailyPicks).toBe(true);
    // Nothing is written: they have not bought anything.
    expect(await db.subscription.count({ where: { userId: admin.id } })).toBe(0);
  });

  it("gives an admin VIP allowances and the daily picks", async () => {
    const admin = await makeAdmin();
    const allowance = await getAiAllowance(admin.id);
    expect(allowance.plan?.code).toMatch(/^vip/);
    expect(allowance.kind).toBe("plan");
    expect(allowance.allowDeepAnalysis).toBe(true);
    expect(await canSeePicks(admin.id)).toBe(true);
  });

  it("changes nothing for an ordinary user", async () => {
    const user = await createUser();
    expect(await getActiveSubscription(user.id)).toBeNull();
    expect(await canSeePicks(user.id)).toBe(false);
    const allowance = await getAiAllowance(user.id);
    expect(allowance.allowDeepAnalysis).toBe(false);
    // Free users still run on trial credits, not a plan.
    expect(allowance.kind).toBe("trial");
  });

  it("lets an admin who really paid keep what they paid for", async () => {
    const admin = await makeAdmin();
    const starter = await db.plan.findFirst({ where: { code: { startsWith: "starter" } } });
    await db.subscription.create({
      data: {
        userId: admin.id,
        planId: starter!.id,
        status: "ACTIVE",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    // A real subscription wins over the grant, so a real purchase is never silently ignored.
    expect((await getActiveSubscription(admin.id))?.plan.code).toBe(starter!.code);
  });

  it("reports the granted plan on the profile", async () => {
    const admin = await makeAdmin();
    const me = await getMe({ id: admin.id, email: admin.email } as Parameters<typeof getMe>[0]);
    expect(me.subscription?.plan).toMatch(/^vip/);
  });
});
