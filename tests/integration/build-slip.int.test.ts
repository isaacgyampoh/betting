import { describe, expect, it } from "vitest";
import { buildToTarget } from "@/lib/services/build-slip";
import { loadSlip } from "@/lib/services/slips";
import { db } from "@/lib/db";
import { createUser } from "./helpers";

/** A plan with room for several builds a day. */
async function proUser() {
  const user = await createUser();
  const plan = await db.plan.findUniqueOrThrow({ where: { code: "pro_week" } });
  await db.subscription.create({
    data: { userId: user.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000) },
  });
  return user;
}

describe("building a slip to a target odds", () => {
  it("reaches the target, books a code, and explains every pick", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });

    const built = await buildToTarget({ user, slipId: source.id, target: 2, ipHash: null });
    expect(built.reachedTarget).toBe(true);
    expect(built.slip.totalOdds!).toBeGreaterThanOrEqual(2);
    expect(built.slip.code).toMatch(/^BC/);
    expect(built.slip.parent?.id).toBe(source.id);
    // one reason per pick, each mentioning the price
    expect(built.reasons).toHaveLength(built.slip.selectionCount);
    for (const r of built.reasons) expect(r.text).toMatch(/Priced at \d/);
    expect(["low", "medium", "high"]).toContain(built.confidence);
    expect(built.chance).toMatch(/chance|likely/);
  });

  it("a higher target gives longer odds and a lower confidence", async () => {
    const user = await proUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const two = await buildToTarget({ user, slipId: source.id, target: 2, ipHash: null });
    const ten = await buildToTarget({ user, slipId: source.id, target: 10, ipHash: null });
    expect(ten.slip.totalOdds!).toBeGreaterThan(two.slip.totalOdds!);
    expect(ten.slip.selectionCount).toBeGreaterThanOrEqual(two.slip.selectionCount);
  });

  it("leaves out games that have started and says so", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BCLIVE", ipHash: null });
    const built = await buildToTarget({ user, slipId: source.id, target: 1.5, ipHash: null });
    expect(built.dropped.some((d) => d.reason === "already started")).toBe(true);
    expect(built.slip.selections.every((s) => !s.started)).toBe(true);
  });

  it("refuses an impossible target politely", async () => {
    const user = await proUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const built = await buildToTarget({ user, slipId: source.id, target: 100000, ipHash: null });
    expect(built.reachedTarget).toBe(false);
    await expect(buildToTarget({ user, slipId: source.id, target: 0.5, ipHash: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
