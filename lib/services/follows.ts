import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { FollowKind } from "@/lib/generated/prisma/enums";

/**
 * What a user follows, and what they want to hear about.
 *
 * Three kinds, because they are genuinely different intentions. Following a **team** means every
 * game it plays, indefinitely. Following a **fixture** means one match and then nothing. The app
 * could previously only do the first, and only on the device - so the server had no idea what
 * anybody cared about and could not have alerted them even with working push credentials.
 *
 * Alerts hang off the individual follow rather than a global setting, because "tell me everything
 * about tonight's final" and "tell me only if Arsenal score" are both reasonable and one global
 * switch cannot express both.
 */
export type AlertPrefs = {
  kickoff: boolean;
  goals: boolean;
  redCards: boolean;
  halfTime: boolean;
  fullTime: boolean;
};

export const DEFAULT_ALERTS: AlertPrefs = {
  kickoff: true,
  goals: true,
  redCards: true,
  // Off by default. A half-time buzz is the one people turn off first, and a notification
  // somebody did not want is worse than one they have to switch on.
  halfTime: false,
  fullTime: true,
};

export type FollowRow = {
  id: string;
  kind: FollowKind;
  targetId: number;
  label: string | null;
  muted: boolean;
  alerts: AlertPrefs;
  createdAt: Date;
};

type Row = {
  id: string;
  kind: FollowKind;
  targetId: number;
  label: string | null;
  mutedAt: Date | null;
  createdAt: Date;
  alertKickoff: boolean;
  alertGoals: boolean;
  alertRedCards: boolean;
  alertHalfTime: boolean;
  alertFullTime: boolean;
};

function shape(row: Row): FollowRow {
  return {
    id: row.id,
    kind: row.kind,
    targetId: row.targetId,
    label: row.label,
    muted: row.mutedAt !== null,
    alerts: {
      kickoff: row.alertKickoff,
      goals: row.alertGoals,
      redCards: row.alertRedCards,
      halfTime: row.alertHalfTime,
      fullTime: row.alertFullTime,
    },
    createdAt: row.createdAt,
  };
}

/** The five flags as the columns they are stored in. */
const columns = (a: AlertPrefs) => ({
  alertKickoff: a.kickoff,
  alertGoals: a.goals,
  alertRedCards: a.redCards,
  alertHalfTime: a.halfTime,
  alertFullTime: a.fullTime,
});

/** Everything this user follows, newest first. */
export async function listFollows(profileId: string): Promise<FollowRow[]> {
  const rows = await db.follow.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(shape);
}

/**
 * Follows something, or updates the label and alerts of a follow that already exists.
 *
 * Idempotent on purpose: a double tap, a retried request after a dropped connection, or two
 * devices acting at once must all end with one follow, not a duplicate or an error. The unique
 * index makes that a database guarantee rather than a hopeful read-then-write.
 */
export async function follow(
  profileId: string,
  kind: FollowKind,
  targetId: number,
  opts: { label?: string | null; alerts?: Partial<AlertPrefs> } = {},
): Promise<FollowRow> {
  const alerts = { ...DEFAULT_ALERTS, ...(opts.alerts ?? {}) };

  // One statement, so a double tap or a retry after a dropped connection cannot race itself into
  // two rows. The unique index makes this a database guarantee rather than a hopeful
  // read-then-write.
  const row = await db.follow.upsert({
    where: { profileId_kind_targetId: { profileId, kind, targetId } },
    create: { profileId, kind, targetId, label: opts.label ?? null, ...columns(alerts) },
    update: {
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      // Only when the caller said something about alerts. Writing the defaults on every follow
      // would silently reset preferences each time a label was refreshed.
      ...(opts.alerts ? columns(alerts) : {}),
    },
  });
  return shape(row);
}

/** Unfollows. Succeeds whether or not it was followed - the user's intent is satisfied either way. */
export async function unfollow(
  profileId: string,
  kind: FollowKind,
  targetId: number,
): Promise<void> {
  await db.follow.deleteMany({ where: { profileId, kind, targetId } });
}

/** Silences a follow without unfollowing it. It stays on the Following screen. */
export async function setMuted(
  profileId: string,
  kind: FollowKind,
  targetId: number,
  muted: boolean,
): Promise<FollowRow> {
  const row = await db.follow.findUnique({
    where: { profileId_kind_targetId: { profileId, kind, targetId } },
  });
  if (!row) throw new AppError("NOT_FOUND", "You are not following that.");
  const updated = await db.follow.update({
    where: { id: row.id },
    data: { mutedAt: muted ? new Date() : null },
  });
  return shape(updated);
}

/**
 * Who should hear about something happening in this fixture.
 *
 * The question the alerting side asks, and the reason `(kind, targetId)` is indexed: without it
 * every goal scans every follow in the system.
 *
 * Both routes to a fixture are considered - following the match itself, and following either
 * side - and a profile that matches both is returned once. Muted follows are excluded here
 * rather than later, so a muted match cannot produce a notification by any path.
 */
export async function audienceFor(
  fixtureId: number,
  teamIds: number[],
  event: keyof AlertPrefs,
): Promise<string[]> {
  const rows = await db.follow.findMany({
    where: {
      mutedAt: null,
      OR: [
        { kind: "FIXTURE", targetId: fixtureId },
        { kind: "TEAM", targetId: { in: teamIds } },
      ],
    },
    select: {
      profileId: true,
      alertKickoff: true,
      alertGoals: true,
      alertRedCards: true,
      alertHalfTime: true,
      alertFullTime: true,
    },
  });

  const column = {
    kickoff: "alertKickoff",
    goals: "alertGoals",
    redCards: "alertRedCards",
    halfTime: "alertHalfTime",
    fullTime: "alertFullTime",
  }[event] as keyof (typeof rows)[number];

  const wanted = new Set<string>();
  for (const row of rows) {
    if (row[column]) wanted.add(row.profileId);
  }
  return [...wanted];
}
