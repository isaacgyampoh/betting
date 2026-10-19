import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { deleteAccount } from "@/lib/services/account";
import { follow } from "@/lib/services/follows";
import { createUser } from "./helpers";

/**
 * A refresh-token row, written directly.
 *
 * `issueSession` would also mint a signed access token, which needs AUTH_JWT_SECRET and has
 * nothing to do with what is under test here: whether the row goes when the profile does.
 */
async function session(profileId: string, userAgent: string) {
  await db.refreshToken.create({
    data: {
      profileId,
      tokenHash: `hash-${profileId}-${userAgent}`,
      familyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      userAgent,
    },
  });
}

/**
 * Deleting an account has to actually delete it.
 *
 * Google Play requires apps with accounts to offer deletion in-app and on the web, and requires
 * that the data goes rather than the row being flagged inactive. The risk with a cascade-based
 * delete is that it looks right and quietly leaves a table behind, because the cascade is
 * declared in the schema rather than in the code under test - nothing in `deleteAccount` names
 * `follows`, so nothing in `deleteAccount` would change if that relation stopped cascading.
 *
 * These tests therefore write real rows across the related tables first and assert the rows are
 * gone afterwards. A schema change that drops a cascade fails here rather than in production.
 */
describe("deleting an account", () => {
  it("removes the profile and everything hanging off it", async () => {
    const user = await createUser();
    await follow(user.id, "FIXTURE", 1557430, { label: "Everton v Chelsea" });
    await follow(user.id, "TEAM", 45, { label: "Everton" });
    await session(user.id, "test-agent");
    await db.deviceToken.create({
      data: { userId: user.id, token: `tok-${user.id}`, platform: "android" },
    });
    // The Google link itself. This is the row that decides whether signing in again returns the
    // old account or starts a new one, so it is the one that most needs to go.
    await db.identity.create({
      data: { profileId: user.id, provider: "google", subject: `sub-${user.id}`, email: user.email },
    });

    // Prove the rows exist, or the assertions after the delete prove nothing at all.
    expect(await db.follow.count({ where: { profileId: user.id } })).toBe(2);
    expect(await db.refreshToken.count({ where: { profileId: user.id } })).toBe(1);
    expect(await db.deviceToken.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.identity.count({ where: { profileId: user.id } })).toBe(1);

    const summary = await deleteAccount(user.id);
    expect(summary.deleted).toBe(true);
    expect(summary.removed.follows).toBe(2);
    expect(summary.removed.devices).toBe(1);

    expect(await db.profile.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await db.follow.count({ where: { profileId: user.id } })).toBe(0);
    expect(await db.refreshToken.count({ where: { profileId: user.id } })).toBe(0);
    expect(await db.deviceToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.identity.count({ where: { profileId: user.id } })).toBe(0);
  });

  it("ends every session, because a deleted account must not keep serving requests", async () => {
    const user = await createUser();
    await session(user.id, "phone");
    await session(user.id, "tablet");
    expect(await db.refreshToken.count({ where: { profileId: user.id } })).toBe(2);

    await deleteAccount(user.id);
    expect(await db.refreshToken.count({ where: { profileId: user.id } })).toBe(0);
  });

  it("does not delete the account of someone who referred them", async () => {
    const inviter = await createUser();
    const invitee = await createUser();
    await db.profile.update({ where: { id: invitee.id }, data: { referredById: inviter.id } });

    await deleteAccount(invitee.id);

    // SetNull, not Cascade: leaving is not grounds for removing the person who invited you.
    const stillThere = await db.profile.findUnique({ where: { id: inviter.id } });
    expect(stillThere).not.toBeNull();
  });

  it("clears the reference when the inviter is the one leaving", async () => {
    const inviter = await createUser();
    const invitee = await createUser();
    await db.profile.update({ where: { id: invitee.id }, data: { referredById: inviter.id } });

    await deleteAccount(inviter.id);

    const survivor = await db.profile.findUnique({ where: { id: invitee.id } });
    expect(survivor).not.toBeNull();
    expect(survivor!.referredById).toBeNull();
  });

  it("refuses an account that holds audit rows, instead of failing on a foreign key", async () => {
    const admin = await createUser();
    await db.adminAudit.create({
      data: { actorId: admin.id, action: "user.suspend", target: "someone" },
    });

    // The point is the explanation. Without the check this is a raw constraint violation and a
    // 500, which tells the person nothing and looks like the feature is broken.
    await expect(deleteAccount(admin.id)).rejects.toBeInstanceOf(AppError);
    await expect(deleteAccount(admin.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.profile.findUnique({ where: { id: admin.id } })).not.toBeNull();
  });

  it("keeps the audit row itself", async () => {
    const admin = await createUser();
    const row = await db.adminAudit.create({
      data: { actorId: admin.id, action: "flag.set", target: "ai.enabled" },
    });
    await expect(deleteAccount(admin.id)).rejects.toBeInstanceOf(AppError);
    expect(await db.adminAudit.findUnique({ where: { id: row.id } })).not.toBeNull();
  });
});
