import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendToUser, canSendPush } from "@/lib/services/fcm";
import { audienceFor, type AlertPrefs } from "@/lib/services/follows";
import { statsProvider } from "@/lib/services/stats";
import type { MatchEvent, MatchSummary } from "@/lib/stats/types";

/**
 * The part of the notification pipeline that did not exist.
 *
 * Tokens were registered, preferences were stored, the sender worked and the device was ready -
 * and nothing ever decided that something had happened. The only caller of `sendToUser` was a
 * manual test endpoint. This is the middle: read the matches people follow, work out what is new
 * since the last pass, and tell the right people once.
 *
 * Run it often while matches are live. It is safe to run at any interval and safe to run twice
 * at once; see `alertKey`.
 */

/** The UTC days a match in play right now could belong to.
 *
 * Both, not just today: a game that kicked off at 23:00 UTC is still being played after
 * midnight, and asking only for today's date would lose it halfway through.
 */
function datesAround(now: Date): string[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return [today, yesterday];
}

/** How far past kick-off a match is still worth polling, for a game that never reports an end. */
const STALE_AFTER_MS = 4 * 60 * 60_000;

export type AlertKind = keyof AlertPrefs;

/**
 * A key that is the same every time the same real-world thing is read.
 *
 * This is the whole deduplication strategy, and it is deliberately derived from the event rather
 * than from when we noticed it. A goal read on five consecutive passes yields one key, so four of
 * those passes insert nothing and send nothing. A counter or a timestamp would produce five.
 *
 * Minute and player are included because a team can score twice; type because a goal and a card
 * in the same minute are different events. VAR can move a goal's minute, which produces a new key
 * and a second alert - the alternative is matching fuzzily and silently dropping a real second
 * goal, which is worse than a rare duplicate.
 */
export function alertKey(fixtureId: number, kind: AlertKind, event?: MatchEvent): string {
  if (!event) return `${fixtureId}:${kind}`;
  const minute = event.extra ? `${event.minute}+${event.extra}` : `${event.minute}`;
  return `${fixtureId}:${kind}:${minute}:${event.player ?? "?"}:${event.side}`;
}

/** What to say. Short, because a notification is read on a lock screen in a glance. */
function wording(
  match: MatchSummary,
  kind: AlertKind,
  event?: MatchEvent,
): { title: string; body: string } {
  const home = match.home.name;
  const away = match.away.name;
  const score = `${match.goals.home ?? 0}-${match.goals.away ?? 0}`;

  switch (kind) {
    case "kickoff":
      return { title: `${home} v ${away}`, body: "Kick-off." };
    case "halfTime":
      return { title: `${home} ${score} ${away}`, body: "Half time." };
    case "fullTime":
      return { title: `${home} ${score} ${away}`, body: "Full time." };
    case "redCards": {
      const who = event?.player ? `${event.player} ` : "";
      const side = event?.side === "HOME" ? home : away;
      return { title: `${home} ${score} ${away}`, body: `Red card — ${who}(${side}).` };
    }
    case "goals":
    default: {
      const scorer = event?.player ?? "Goal";
      const side = event?.side === "HOME" ? home : away;
      const own = event?.type === "OWN_GOAL" ? " (own goal)" : "";
      return { title: `${home} ${score} ${away}`, body: `${scorer}${own} — ${side}.` };
    }
  }
}

/** Events worth an alert, paired with the preference that governs them. */
function alertable(events: MatchEvent[]): { kind: AlertKind; event: MatchEvent }[] {
  const out: { kind: AlertKind; event: MatchEvent }[] = [];
  for (const event of events) {
    if (event.type === "GOAL" || event.type === "OWN_GOAL" || event.type === "PENALTY") {
      out.push({ kind: "goals", event });
    } else if (event.type === "RED" || event.type === "SECOND_YELLOW") {
      out.push({ kind: "redCards", event });
    }
  }
  return out;
}

/**
 * Claims the right to send one alert to one person.
 *
 * Returns false if it has already been sent. The unique index does the work: two passes racing
 * each other both attempt the insert and exactly one succeeds, so the question "has this been
 * sent?" is answered by trying to record it rather than by reading first and writing after -
 * which is the version with a gap between the check and the write.
 */
async function claim(profileId: string, eventKey: string, fixtureId: number): Promise<boolean> {
  try {
    await db.notificationDelivery.create({ data: { profileId, eventKey, fixtureId } });
    return true;
  } catch {
    // The only expected failure is the unique constraint, meaning somebody already claimed it.
    return false;
  }
}

export type AlertRun = {
  fixturesChecked: number;
  eventsConsidered: number;
  notificationsSent: number;
  alreadySent: number;
  skipped: string[];
};

/**
 * One pass: look at every followed match that could be in play, and alert on what is new.
 *
 * Only fixtures somebody actually follows are read, so this costs nothing on a quiet day and does
 * not touch the provider at all when nobody is following anything live.
 */
export async function runMatchAlerts(now = new Date()): Promise<AlertRun> {
  const run: AlertRun = {
    fixturesChecked: 0,
    eventsConsidered: 0,
    notificationsSent: 0,
    alreadySent: 0,
    skipped: [],
  };

  if (!canSendPush()) {
    run.skipped.push("push_not_configured");
    return run;
  }

  const [fixtureFollows, teamFollows] = await Promise.all([
    db.follow.findMany({
      where: { kind: "FIXTURE", mutedAt: null },
      select: { targetId: true },
      distinct: ["targetId"],
    }),
    db.follow.findMany({
      where: { kind: "TEAM", mutedAt: null },
      select: { targetId: true },
      distinct: ["targetId"],
    }),
  ]);
  if (fixtureFollows.length === 0 && teamFollows.length === 0) return run;

  const provider = statsProvider();
  const fixtureIds = new Set(fixtureFollows.map((f) => f.targetId));

  // Followed teams have to contribute their fixtures too, or following a team produces no
  // alerts whatsoever - the first version of this polled only directly-followed fixtures, so a
  // team follower was counted in the audience for a match that was never read in the first
  // place. Today's list is one call and already cached; it is where a team's game of the day is.
  if (teamFollows.length > 0) {
    const followedTeams = new Set(teamFollows.map((f) => f.targetId));
    for (const date of datesAround(now)) {
      try {
        for (const fixture of await provider.fixturesByDate(date)) {
          if (followedTeams.has(fixture.home.id) || followedTeams.has(fixture.away.id)) {
            fixtureIds.add(fixture.id);
          }
        }
      } catch (err) {
        logger.warn("alerts.day_failed", { date, err });
      }
    }
  }

  for (const fixtureId of fixtureIds) {
    let match: MatchSummary | null = null;
    try {
      match = await provider.fixture(fixtureId);
    } catch (err) {
      // One unreadable fixture must not stop the rest of the run.
      logger.warn("alerts.fixture_failed", { fixtureId, err });
      continue;
    }
    if (!match) continue;

    // Nothing to say about a match that has not started, and nothing worth polling about one
    // that ended hours ago and never reported it.
    const kickoff = new Date(match.kickoffAt).getTime();
    if (match.status === "SCHEDULED" && kickoff > now.getTime()) continue;
    if (match.status !== "LIVE" && now.getTime() - kickoff > STALE_AFTER_MS) continue;

    run.fixturesChecked += 1;

    // Fetched only for a match that is actually in play or just finished, so a day of followed
    // fixtures that have not kicked off costs one call each and no event lookups at all.
    let events: MatchEvent[] = [];
    try {
      events = await provider.events(fixtureId, match.home.id, match.status === "FINISHED");
    } catch (err) {
      // A competition with no event coverage, or a provider hiccup. The status-based moments
      // below still work, so this is a partial result rather than a failure.
      logger.warn("alerts.events_failed", { fixtureId, err });
    }

    const moments: { kind: AlertKind; event?: MatchEvent }[] = [];
    if (match.status === "LIVE" || match.status === "FINISHED") {
      moments.push({ kind: "kickoff" });
    }
    if (match.status === "FINISHED") moments.push({ kind: "fullTime" });
    moments.push(...alertable(events));

    for (const moment of moments) {
      run.eventsConsidered += 1;
      const key = alertKey(fixtureId, moment.kind, moment.event);
      const audience = await audienceFor(
        fixtureId,
        [match.home.id, match.away.id],
        moment.kind,
      );

      for (const profileId of audience) {
        if (!(await claim(profileId, key, fixtureId))) {
          run.alreadySent += 1;
          continue;
        }
        const { title, body } = wording(match, moment.kind, moment.event);
        try {
          const result = await sendToUser(profileId, {
            title,
            body,
            route: `/home/match/${fixtureId}`,
          });
          run.notificationsSent += result.sent;
        } catch (err) {
          // The claim stays. Re-sending on the next pass would mean a user whose device is
          // briefly unreachable gets the goal announced repeatedly once it returns, which is
          // worse than missing one alert for a match they can simply open.
          logger.warn("alerts.send_failed", { profileId, fixtureId, err });
        }
      }
    }
  }

  logger.info("alerts.run", { ...run, skipped: run.skipped.join(",") });
  return run;
}
