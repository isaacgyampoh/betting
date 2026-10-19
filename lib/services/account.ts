import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Deleting an account, for real.
 *
 * Google Play requires any app with accounts to offer deletion both inside the app and at a web
 * address a person can reach without installing it, and requires that it actually removes the
 * data rather than deactivating a row. This is that operation; `/delete-account` on the site and
 * the control in the app's Profile tab both end up here.
 *
 * Almost everything goes by cascade from `profiles`: identities, refresh tokens, follows, slips
 * and their selections, usage logs, push subscriptions, device tokens, subscriptions, payments
 * and referral rewards all declare `onDelete: Cascade`. Listing them here instead would be a
 * second place to forget a table the next time one is added, and the database already knows.
 *
 * Two relations deliberately do not cascade:
 *
 *   - `referredById` is `SetNull`. Someone else's account must not disappear because the person
 *     who invited them left.
 *   - `admin_audit.actor_id` restricts, because an audit trail that can be erased by deleting the
 *     account that generated it is not an audit trail. Staff accounts are refused below with an
 *     explanation rather than failing on a foreign key further down.
 *
 * Because `identities` goes too, signing in afterwards with the same Google account produces a
 * new, empty profile rather than resurrecting the old one. That is the intended meaning of
 * deletion, and it is why the confirmation text says the slips are not recoverable.
 */
export type DeletionSummary = {
  deleted: true;
  /** What was removed, for the response and the log. Counted before the delete, not guessed. */
  removed: { slips: number; follows: number; devices: number; identities: number };
};

export async function deleteAccount(userId: string): Promise<DeletionSummary> {
  const auditRows = await db.adminAudit.count({ where: { actorId: userId } });
  if (auditRows > 0) {
    // Not a dead end: the account can be deleted once its audit rows have been reassigned or the
    // retention period for them has passed. That is a deliberate decision, not something to do
    // silently inside a user-facing delete.
    throw new AppError(
      "FORBIDDEN",
      "This account has taken administrative actions, which are kept as an audit record. Contact support to have it closed.",
    );
  }

  const [slips, follows, devices, identities] = await Promise.all([
    db.slip.count({ where: { userId } }),
    db.follow.count({ where: { profileId: userId } }),
    db.deviceToken.count({ where: { userId } }),
    db.identity.count({ where: { profileId: userId } }),
  ]);

  // One statement. The cascades run inside the database's own transaction, so there is no window
  // in which the profile is gone but its slips are not.
  await db.profile.delete({ where: { id: userId } });

  // No email, no display name, no identity subject: the point of the operation is that those are
  // gone, and writing them into a log would keep a copy of exactly what was asked to be removed.
  logger.info("account.deleted", { userId, slips, follows, devices, identities });

  return { deleted: true, removed: { slips, follows, devices, identities } };
}
