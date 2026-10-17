import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/identity/admin";
import { revokeAllSessions } from "@/lib/identity/session";

/**
 * What the dashboard asks the database.
 *
 * Two rules hold throughout, and both are about not letting the dashboard become the slowest
 * thing in the system as the user table grows:
 *
 *   - Counts are counts. `count()` and `groupBy`, never `findMany().length`.
 *   - Lists are paginated at the database, with a hard ceiling the caller cannot raise.
 *
 * It is tempting to skip this while there are 13 users. The time to write it is now, because the
 * query that loads every row works perfectly until the day it does not.
 */

/** Signed in within this window counts as active. Stated here so the number has one meaning. */
export const ACTIVE_WINDOW_DAYS = 30;

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type Overview = {
  users: { total: number; today: number; week: number; month: number; active: number; suspended: number };
  slips: { total: number; week: number };
  sessions: { live: number };
  recent: { id: string; email: string | null; createdAt: Date; lastSignInAt: Date | null; suspended: boolean }[];
};

export async function overview(): Promise<Overview> {
  // Issued as one batch rather than nine awaits in a row. Against a database in another region
  // the difference is nine round trips versus one.
  const [total, today, week, month, active, suspended, slipsTotal, slipsWeek, liveSessions, recent] =
    await db.$transaction([
      db.profile.count(),
      db.profile.count({ where: { createdAt: { gte: startOfToday() } } }),
      db.profile.count({ where: { createdAt: { gte: since(7) } } }),
      db.profile.count({ where: { createdAt: { gte: since(30) } } }),
      db.profile.count({ where: { lastSignInAt: { gte: since(ACTIVE_WINDOW_DAYS) } } }),
      db.profile.count({ where: { suspendedAt: { not: null } } }),
      db.slip.count(),
      db.slip.count({ where: { createdAt: { gte: since(7) } } }),
      db.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.profile.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, email: true, createdAt: true, lastSignInAt: true, suspendedAt: true },
      }),
    ]);

  return {
    users: { total, today, week, month, active, suspended },
    slips: { total: slipsTotal, week: slipsWeek },
    sessions: { live: liveSessions },
    recent: recent.map((r) => ({
      id: r.id,
      email: r.email,
      createdAt: r.createdAt,
      lastSignInAt: r.lastSignInAt,
      suspended: r.suspendedAt !== null,
    })),
  };
}

export type UserRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  createdAt: Date;
  lastSignInAt: Date | null;
  suspended: boolean;
  slips: number;
  providers: string[];
};

/** A page of users. `take` is clamped here, not trusted from the query string. */
export async function listUsers(opts: { search?: string; page?: number; take?: number }) {
  const take = Math.min(50, Math.max(5, opts.take ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const needle = opts.search?.trim();

  const where = needle
    ? {
        OR: [
          { email: { contains: needle, mode: "insensitive" as const } },
          { displayName: { contains: needle, mode: "insensitive" as const } },
          // An exact id, so a user can be found from a log line. Only when it looks like one:
          // feeding arbitrary text to a uuid comparison is an error, not a miss.
          ...(/^[0-9a-f-]{36}$/i.test(needle) ? [{ id: needle }] : []),
        ],
      }
    : {};

  const [total, rows] = await db.$transaction([
    db.profile.count({ where }),
    db.profile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
        lastSignInAt: true,
        suspendedAt: true,
        identities: { select: { provider: true } },
        // Counted by the database. Selecting the slips themselves to call .length on them would
        // pull every selection of every slip across the page.
        _count: { select: { slips: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    take,
    pages: Math.max(1, Math.ceil(total / take)),
    users: rows.map((r): UserRow => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      role: r.role,
      createdAt: r.createdAt,
      lastSignInAt: r.lastSignInAt,
      suspended: r.suspendedAt !== null,
      slips: r._count.slips,
      providers: r.identities.map((i) => i.provider),
    })),
  };
}

/**
 * One user, in as much detail as the dashboard shows.
 *
 * Note what is absent: no token, no token hash, no password material, no raw provider payload.
 * The dashboard exists to answer "who is this and what have they done", and a session token
 * answers neither while being the one thing that would let an administrator become them.
 */
export async function userDetail(id: string) {
  const profile = await db.profile.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      createdAt: true,
      lastSignInAt: true,
      suspendedAt: true,
      suspendedReason: true,
      ageConfirmedAt: true,
      excludedUntil: true,
      identities: { select: { provider: true, email: true, createdAt: true, lastSeenAt: true } },
      _count: { select: { slips: true, payments: true, subscriptions: true } },
    },
  });
  if (!profile) throw new AppError("NOT_FOUND", "No such user.");

  const [sessions, recentSlips] = await db.$transaction([
    db.refreshToken.findMany({
      where: { profileId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 10,
      // tokenHash is deliberately not selected.
      select: { id: true, createdAt: true, expiresAt: true, userAgent: true },
    }),
    db.slip.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        kind: true,
        bookingCode: true,
        bookmaker: { select: { slug: true, name: true } },
      },
    }),
  ]);

  return { profile, sessions, recentSlips };
}

/**
 * Blocks an account.
 *
 * Suspending also revokes every refresh token, because a suspension that leaves live sessions
 * running is not a suspension. The access token already issued stays valid until it expires -
 * see lib/identity/session.ts on why that hour exists - so the account is fully out within the
 * hour and cannot renew past it.
 */
export async function suspendUser(actorId: string, targetId: string, reason: string) {
  if (actorId === targetId) {
    // Not a safety rail so much as an obvious footgun: the person clicking is the person who
    // would then be locked out of the dashboard they clicked it in.
    throw new AppError("BAD_REQUEST", "You cannot suspend your own account.");
  }
  const target = await db.profile.findUnique({ where: { id: targetId }, select: { role: true } });
  if (!target) throw new AppError("NOT_FOUND", "No such user.");

  await db.profile.update({
    where: { id: targetId },
    data: { suspendedAt: new Date(), suspendedReason: reason.slice(0, 500) },
  });
  const revoked = await revokeAllSessions(targetId);
  await audit(actorId, "user.suspend", targetId, { reason: reason.slice(0, 500), sessionsRevoked: revoked });
  return { revoked };
}

export async function reactivateUser(actorId: string, targetId: string) {
  const target = await db.profile.findUnique({
    where: { id: targetId },
    select: { suspendedAt: true },
  });
  if (!target) throw new AppError("NOT_FOUND", "No such user.");

  await db.profile.update({
    where: { id: targetId },
    data: { suspendedAt: null, suspendedReason: null },
  });
  // Sessions are not restored. They were revoked, and revoked is final; the user signs in again.
  await audit(actorId, "user.reactivate", targetId, {});
}

/** The audit trail, newest first. Read-only everywhere: nothing updates or deletes these. */
export async function auditTrail(opts: { page?: number; take?: number } = {}) {
  const take = Math.min(100, Math.max(10, opts.take ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const [total, entries] = await db.$transaction([
    db.adminAudit.count(),
    db.adminAudit.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        action: true,
        target: true,
        detail: true,
        createdAt: true,
        actor: { select: { id: true, email: true } },
      },
    }),
  ]);
  return { total, page, take, pages: Math.max(1, Math.ceil(total / take)), entries };
}

/** Feature flags and settings an administrator may change without a deploy. */
export async function settings() {
  return db.appSetting.findMany({ orderBy: { key: "asc" } });
}

export async function setSetting(actorId: string, key: string, value: unknown, description?: string) {
  const before = await db.appSetting.findUnique({ where: { key } });
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: value as never, description, updatedBy: actorId },
    update: { value: value as never, description, updatedBy: actorId },
  });
  await audit(actorId, "setting.set", key, { from: before?.value ?? null, to: value });
}

export type ServiceHealth = {
  database: { up: boolean; ms: number };
  cache: { total: number; fresh: number };
  usage: { lastHour: number; failedDay: number };
  devices: number;
  checkedAt: Date;
};

/**
 * Everything the health page reports, gathered here rather than in the page.
 *
 * Two reasons. A page that issues its own queries drifts away from the service layer that every
 * other page uses; and the lint rule that forbids impure calls during render is right that
 * `Date.now()` belongs outside a component. The page became a renderer of this result.
 */
export async function serviceHealth(): Promise<ServiceHealth> {
  const started = Date.now();
  let up = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    up = false;
  }
  const ms = Date.now() - started;

  const now = Date.now();
  const [total, fresh, failedDay, lastHour, devices] = await db.$transaction([
    db.statsCache.count(),
    db.statsCache.count({ where: { expiresAt: { gt: new Date(now) } } }),
    db.usageLog.count({ where: { success: false, createdAt: { gte: new Date(now - 86_400_000) } } }),
    db.usageLog.count({ where: { createdAt: { gte: new Date(now - 3_600_000) } } }),
    db.deviceToken.count({ where: { revokedAt: null } }),
  ]);

  return {
    database: { up, ms },
    cache: { total, fresh },
    usage: { lastHour, failedDay },
    devices,
    checkedAt: new Date(now),
  };
}
