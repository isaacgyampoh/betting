import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { verifyGoogleIdToken } from "@/lib/identity/google";
import { issueSession, type IssuedSession } from "@/lib/identity/session";

/**
 * Turning a verified Google identity into a GameClaw session.
 *
 * Three cases, in strict order, and the order is the security:
 *
 *   1. **Known identity.** We have seen this Google `sub` before; it owns a profile. Sign in.
 *   2. **Known email, no identity yet.** A profile exists with this address but has never signed
 *      in through this provider. This is the migration case: the 7 existing users were created
 *      by Supabase and have profiles, but no row in our `identities` table. Link them - *only*
 *      when Google says the address is verified.
 *   3. **Neither.** A new person. Create a profile and an identity together.
 *
 * Case 2 is the one that must be got right. Matching on email is how an attacker takes over an
 * account: sign up to any identity provider with somebody else's address and claim their profile.
 * It is safe here only because the address comes from a Google ID token whose signature,
 * audience and `email_verified` claim have all been checked, which means Google is asserting
 * that this person controls that mailbox. If `email_verified` is false we fall through to case 3
 * and they get their own, separate account rather than somebody else's.
 */
export async function signInWithGoogle(
  idToken: string,
  userAgent?: string | null,
): Promise<IssuedSession & { isNew: boolean }> {
  const audience = env().GOOGLE_WEB_CLIENT_ID ?? "";
  const google = await verifyGoogleIdToken(idToken, audience);

  // 1. Known identity.
  const existing = await db.identity.findUnique({
    where: { provider_subject: { provider: "google", subject: google.subject } },
    include: { profile: { select: { id: true, email: true, role: true, suspendedAt: true } } },
  });

  if (existing) {
    if (existing.profile.suspendedAt) {
      throw new AppError("FORBIDDEN", "This account has been suspended.");
    }
    await db.$transaction([
      db.identity.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), email: google.email },
      }),
      db.profile.update({
        where: { id: existing.profileId },
        data: { lastSignInAt: new Date() },
      }),
    ]);
    return {
      ...(await issueSession(
        { id: existing.profile.id, email: existing.profile.email, role: existing.profile.role },
        userAgent,
      )),
      isNew: false,
    };
  }

  // 2. Known email, verified by Google, not yet linked.
  if (google.email && google.emailVerified) {
    const byEmail = await db.profile.findFirst({
      where: { email: { equals: google.email, mode: "insensitive" } },
      select: { id: true, email: true, role: true, suspendedAt: true },
    });
    if (byEmail) {
      if (byEmail.suspendedAt) throw new AppError("FORBIDDEN", "This account has been suspended.");
      await db.$transaction([
        db.identity.create({
          data: {
            profileId: byEmail.id,
            provider: "google",
            subject: google.subject,
            email: google.email,
          },
        }),
        db.profile.update({ where: { id: byEmail.id }, data: { lastSignInAt: new Date() } }),
      ]);
      logger.info("identity.linked", { profileId: byEmail.id, provider: "google" });
      return {
        ...(await issueSession(
          { id: byEmail.id, email: byEmail.email, role: byEmail.role },
          userAgent,
        )),
        isNew: false,
      };
    }
  }

  // 3. Somebody new.
  const profile = await db.profile.create({
    data: {
      id: crypto.randomUUID(),
      email: google.email,
      displayName: google.name,
      avatarUrl: google.picture,
      lastSignInAt: new Date(),
      identities: {
        create: { provider: "google", subject: google.subject, email: google.email },
      },
    },
    select: { id: true, email: true, role: true },
  });
  logger.info("identity.created", { profileId: profile.id, provider: "google" });

  return {
    ...(await issueSession(profile, userAgent)),
    isNew: true,
  };
}
