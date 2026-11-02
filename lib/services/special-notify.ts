import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ghanaDate } from "@/lib/services/daily-picks";
import { notifyUser } from "@/lib/services/push";

/**
 * Telling people the day's special selections are up.
 *
 * Three rules from the brief, each enforced by a different mechanism rather than by care:
 *
 *   * **Only on a successful publication.** The caller passes how many were published and this
 *     returns immediately on zero. Nothing qualifying is a normal day, and a notification saying
 *     so would train people to ignore the ones that matter.
 *   * **Never twice.** One row per person per day in `notification_deliveries`, claimed by its
 *     unique index before the send. A second cron run in the same slot, or two running at once,
 *     insert nothing and send nothing. The claim is per person, so a user who subscribes at
 *     lunchtime still gets that day's notification on the next pass while everyone else does not.
 *   * **No betting content.** Web push here is payload-less by design (see `lib/services/push.ts`
 *     and `public/sw.js`): the service worker shows a fixed line and links to /picks, where the
 *     plan check still applies. Nothing about which market or which match crosses the push service.
 *
 * The audience is people who asked: a web push subscription exists only because somebody used the
 * toggle on the picks page. Native app installs are not included - the Android app has no picks
 * screen to open, so a notification would lead nowhere.
 *
 * Whether anything was published is read from the database rather than taken from the caller, so a
 * rerun that publishes nothing because the day is already published still reaches somebody who
 * subscribed since the first run, and a day where nothing qualified stays silent however often the
 * job runs.
 */

/** Stable per day, so the unique index on (profileId, eventKey) is the whole deduplication. */
export const specialNotifyKey = (date: string) => `special-picks:${date}`;

export type SpecialNotifyResult = { notified: number; alreadyNotified: number; recipients: number };

export async function notifySpecialPicks(date = ghanaDate()): Promise<SpecialNotifyResult> {
  const empty = { notified: 0, alreadyNotified: 0, recipients: 0 };

  const picks = await db.specialPick.findMany({
    where: { forDate: new Date(date) },
    select: { statsFixtureId: true },
    orderBy: { position: "asc" },
  });
  if (!picks.length) return empty;

  const subscribers = await db.pushSubscription.findMany({ select: { userId: true }, distinct: ["userId"] });
  if (!subscribers.length) return empty;

  const key = specialNotifyKey(date);
  const fixtureId = picks[0].statsFixtureId;
  const body = picks.length > 1 ? "Today's special picks are ready." : "Today's special pick is ready.";
  let notified = 0;
  let alreadyNotified = 0;

  for (const { userId } of subscribers) {
    // Claim before sending. The other order would send twice whenever the write failed.
    try {
      await db.notificationDelivery.create({ data: { profileId: userId, eventKey: key, fixtureId } });
    } catch {
      // The only expected failure is the unique constraint: this person has already been told.
      alreadyNotified++;
      continue;
    }

    const { sent } = await notifyUser(userId, { title: "gameclaw", body, url: "/picks" });
    notified += sent;
  }

  logger.info("special.notified", { date, published: picks.length, recipients: subscribers.length, notified, alreadyNotified });
  return { notified, alreadyNotified, recipients: subscribers.length };
}
