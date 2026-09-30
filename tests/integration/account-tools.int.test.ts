import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyReferral, assertNotExcluded, getReferralSummary, getResponsibleSettings, REFERRAL_DAYS, updateResponsibleSettings } from "@/lib/services/account-tools";
import { requireAdult } from "@/lib/auth";
import { createUser } from "./helpers";

describe("referrals", () => {
  it("gives both sides free days, once", async () => {
    const referrer = await createUser();
    const friend = await createUser();
    const { code } = await getReferralSummary(referrer);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    expect(await applyReferral(friend, code)).toEqual({ applied: true });
    // repeat attempts change nothing
    expect(await applyReferral(friend, code)).toEqual({ applied: false });

    const summary = await getReferralSummary(referrer);
    expect(summary.joined).toBe(1);
    expect(summary.daysEarned).toBe(REFERRAL_DAYS);
    expect((await getReferralSummary(friend)).daysEarned).toBe(REFERRAL_DAYS);
  });

  it("ignores self-referral and unknown codes", async () => {
    const user = await createUser();
    const { code } = await getReferralSummary(user);
    expect(await applyReferral(user, code)).toEqual({ applied: false });
    expect(await applyReferral(await createUser(), "ZZZZZZ")).toEqual({ applied: false });
  });

  it("codes are stable and unique per user", async () => {
    const a = await createUser();
    const b = await createUser();
    const first = await getReferralSummary(a);
    expect((await getReferralSummary(a)).code).toBe(first.code);
    expect((await getReferralSummary(b)).code).not.toBe(first.code);
  });
});

describe("responsible gambling tools", () => {
  it("saves a spending note and the reminder setting", async () => {
    const user = await createUser();
    expect(await getResponsibleSettings(user)).toEqual({ spendNoteGhs: null, remindersOn: false, excludedUntil: null });
    const saved = await updateResponsibleSettings(user, { spendNoteGhs: 50, remindersOn: true });
    expect(saved).toMatchObject({ spendNoteGhs: 50, remindersOn: true });
    expect(await updateResponsibleSettings(user, { spendNoteGhs: null })).toMatchObject({ spendNoteGhs: null, remindersOn: true });
  });

  it("a break blocks betting features and cannot be shortened", async () => {
    const user = await createUser();
    await updateResponsibleSettings(user, { excludeDays: 30 });

    await expect(assertNotExcluded(user.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // the shared guard every betting API uses
    await expect(requireAdult(null)).rejects.toBeTruthy();

    // shortening is refused; extending is allowed
    await expect(updateResponsibleSettings(user, { excludeDays: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("can't be shortened"),
    });
    const extended = await updateResponsibleSettings(user, { excludeDays: 60 });
    expect(new Date(extended.excludedUntil!).getTime()).toBeGreaterThan(Date.now() + 50 * 86_400_000);
  });

  it("rejects an out-of-range break", async () => {
    const user = await createUser();
    await expect(updateResponsibleSettings(user, { excludeDays: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(updateResponsibleSettings(user, { excludeDays: 400 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await getResponsibleSettings(user)).excludedUntil).toBeNull();
  });

  it("an expired break stops blocking", async () => {
    const user = await createUser();
    await db.profile.update({ where: { id: user.id }, data: { excludedUntil: new Date(Date.now() - 1000) } });
    await expect(assertNotExcluded(user.id)).resolves.toBeUndefined();
  });
});
