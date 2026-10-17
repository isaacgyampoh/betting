import { cookies } from "next/headers";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { clientIpHash } from "@/lib/request";
import { ADMIN_COOKIE } from "@/lib/identity/admin";
import { verifyGoogleIdToken } from "@/lib/identity/google";
import { issueSession } from "@/lib/identity/session";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/services/usage";

const schema = z.object({ credential: z.string().trim().min(40).max(8192) });

/**
 * How an administrator signs in to the dashboard from a browser.
 *
 * This did not exist, and its absence made the dashboard unreachable: `getAdmin()` reads the
 * `gc_admin_session` cookie, and nothing in the application ever set it. The sign-in page told
 * people to sign in through the mobile app, which cannot work - an app token lives in the
 * device's secure storage and never becomes a cookie in a browser on a different machine.
 *
 * It was missed because the tests minted the cookie by hand. Every check of "an admin gets in"
 * passed, because every check supplied the thing a real person had no way to obtain.
 *
 * The flow: Google Identity Services gives the browser an ID token; this verifies it exactly as
 * the mobile endpoint does, insists the account is an administrator **in the database**, and only
 * then sets the session cookie.
 */
export const POST = route(async (req) => {
  await enforceRateLimit({
    ipHash: clientIpHash(req),
    kind: "AUTH",
    limit: 10,
    windowMs: 10 * 60_000,
  });

  const { credential } = await parseBody(req, schema);
  const google = await verifyGoogleIdToken(credential, env().GOOGLE_WEB_CLIENT_ID ?? "");

  // Matched on the Google subject, the same way the mobile sign-in does. Email is a fallback for
  // an administrator who has never signed in on a device, and only when Google says it is
  // verified - an unverified address must never select an account.
  const identity = await db.identity.findUnique({
    where: { provider_subject: { provider: "google", subject: google.subject } },
    select: { profile: { select: { id: true, email: true, role: true, suspendedAt: true } } },
  });
  const profile =
    identity?.profile ??
    (google.email && google.emailVerified
      ? await db.profile.findFirst({
          where: { email: { equals: google.email, mode: "insensitive" } },
          select: { id: true, email: true, role: true, suspendedAt: true },
        })
      : null);

  if (!profile || profile.role !== "ADMIN" || profile.suspendedAt) {
    // One refusal for "no such account", "not an administrator" and "suspended". Distinguishing
    // them tells whoever is probing which addresses exist and which are privileged.
    logger.warn("admin.sign_in_refused", { subject: google.subject });
    throw new AppError("FORBIDDEN", "Not available.");
  }

  const session = await issueSession(
    { id: profile.id, email: profile.email, role: profile.role },
    req.headers.get("user-agent"),
  );

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, session.accessToken, {
    httpOnly: true, // never readable by script, so an XSS cannot lift the session
    secure: true,
    sameSite: "lax", // survives the redirect back from Google, blocks cross-site POSTs
    path: "/",
    maxAge: session.expiresIn,
  });

  logger.info("admin.signed_in", { profileId: profile.id });
  return ok({ signed_in: true });
});

/** Signs the browser out. Clears the cookie whether or not one was present. */
export const DELETE = route(async () => {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  return ok({ signed_out: true });
});
