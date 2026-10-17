import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { readAccessToken, type SessionClaims } from "@/lib/identity/session";

/**
 * Who may use the admin dashboard, decided on the server, every time.
 *
 * The role is read from the database on every call and never from the token. The token carries a
 * role claim so ordinary requests can avoid a round trip, but an administrative action is not an
 * ordinary request: a token is valid for an hour, and somebody whose admin rights were removed
 * forty minutes ago must not still be able to suspend accounts. The extra query is the point.
 *
 * It is also never read from anything the client sends. There is no `?admin=1`, no header, no
 * field in a request body that influences this.
 */
export const ADMIN_COOKIE = "gc_admin_session";

export type AdminUser = { id: string; email: string | null };

async function claimsFromCookie(): Promise<SessionClaims | null> {
  // `cookies()` throws outside a request scope rather than returning nothing, so without this
  // the bearer-token branch below was unreachable for every caller that is not a React request -
  // a script, a job, a test. The cookie is one of two ways in; failing to find it is ordinary.
  let jar;
  try {
    jar = await cookies();
  } catch {
    return null;
  }
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return readAccessToken(token);
}

/**
 * The admin for this request, or null.
 *
 * Checks the session cookie first, then a bearer token, so the same guard serves the dashboard's
 * own pages and any scripted access.
 */
export async function getAdmin(authorization?: string | null): Promise<AdminUser | null> {
  let claims = await claimsFromCookie();
  if (!claims) {
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) claims = await readAccessToken(bearer);
  }
  if (!claims) return null;

  // The authoritative check. Not the token's role claim.
  const profile = await db.profile.findUnique({
    where: { id: claims.id },
    select: { id: true, email: true, role: true, suspendedAt: true },
  });
  if (!profile || profile.role !== "ADMIN" || profile.suspendedAt) return null;
  return { id: profile.id, email: profile.email };
}

/** Same, but refuses rather than returning null. Every protected admin route calls this. */
export async function requireAdmin(authorization?: string | null): Promise<AdminUser> {
  const admin = await getAdmin(authorization);
  if (!admin) {
    // One message for "not signed in", "not an admin" and "suspended". Telling an unauthorised
    // caller which of those applies tells them whether the account they are probing exists and
    // whether it is privileged.
    throw new AppError("FORBIDDEN", "Not available.");
  }
  return admin;
}

/**
 * Records an administrative action.
 *
 * Called after the change succeeds, never before: an audit trail that lists things that did not
 * happen is worse than none, because it is believed. Failures are logged rather than thrown -
 * losing the audit row must not roll back the action the administrator already saw succeed - but
 * that is a trade worth knowing about, so it is logged at error level.
 */
export async function audit(
  actorId: string,
  action: string,
  target?: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.adminAudit.create({
      data: {
        actorId,
        action,
        target: target ?? null,
        // Cast at the boundary: Prisma's Json input type does not accept a plain
        // Record<string, unknown>, and widening the parameter instead would push the awkwardness
        // on to every caller.
        detail: (detail ?? undefined) as never,
      },
    });
  } catch (err) {
    logger.error("admin.audit_failed", { actorId, action, target, err });
  }
}
