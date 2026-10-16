import "server-only";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Native push registrations, one row per install.
 *
 * The FCM token is the identity of an install, not of a sign-in, which drives the whole design:
 *
 *  * It is unique. Firebase re-issues the same token to the same app install, so registering again
 *    after a different user signs in must MOVE the row rather than add a second one. Without that,
 *    a shared phone would end up subscribed for two people and the previous user would keep
 *    getting alerts about teams they no longer follow - on someone else's device.
 *  * Signing out revokes this device's token only. Other devices the same account uses are
 *    untouched, because signing out of a phone says nothing about a tablet.
 *  * A token Firebase reports as unregistered is marked revoked rather than deleted, so a send
 *    loop stops retrying it and the history of the install survives.
 */
export async function registerDevice(user: AuthUser, token: string, platform = "android") {
  await db.$executeRaw`
    insert into device_tokens (user_id, token, platform)
    values (${user.id}::uuid, ${token}, ${platform})
    on conflict (token) do update
      set user_id = excluded.user_id,
          platform = excluded.platform,
          revoked_at = null,
          updated_at = now()
  `;
}

/** Removes one device's registration. Used on sign-out, and on an explicit opt-out. */
export async function unregisterDevice(token: string) {
  await db.$executeRaw`delete from device_tokens where token = ${token}`;
}

/** Marks a token dead after Firebase rejects it, so it stops being retried. */
export async function revokeDevice(token: string) {
  await db.$executeRaw`update device_tokens set revoked_at = now(), updated_at = now() where token = ${token}`;
}

/** Live tokens for a user, newest first. Revoked ones are never returned. */
export async function devicesFor(userId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ token: string }[]>`
    select token from device_tokens
    where user_id = ${userId}::uuid and revoked_at is null
    order by updated_at desc
  `;
  return rows.map((r) => r.token);
}
