import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { verifyAppleIdToken } from "@/lib/identity/apple";
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
  return signInWithIdentity(
    {
      provider: "google",
      subject: google.subject,
      email: google.email,
      emailVerified: google.emailVerified,
      displayName: google.name,
      avatarUrl: google.picture,
    },
    userAgent,
  );
}

/**
 * Turning a verified Apple identity into a GameClaw session.
 *
 * The audience is the iOS bundle identifier, because Apple stamps `aud` with it for a native app.
 *
 * One behaviour worth knowing before it surprises somebody. If a person already has an account
 * from Google and then signs in with Apple choosing **Hide My Email**, Apple issues a per-app
 * relay address that matches nothing we hold, so case 2 cannot fire and they get a second,
 * separate account. That is not a bug we can fix: the whole point of the relay is that the real
 * address is never disclosed, so there is nothing to match on. Choosing to share the real address
 * links the accounts as expected. Apple requires the hide option to be offered, so both paths have
 * to be acceptable.
 */
export async function signInWithApple(
  idToken: string,
  userAgent?: string | null,
  rawNonce?: string | null,
): Promise<IssuedSession & { isNew: boolean }> {
  const audience = env().APPLE_BUNDLE_ID ?? "";
  const apple = await verifyAppleIdToken(idToken, audience, rawNonce);
  return signInWithIdentity(
    {
      provider: "apple",
      subject: apple.subject,
      email: apple.email,
      // A relay address is verified by Apple exactly as a real one is, and is unique to this app
      // and this person, so matching on it is as safe as matching a Google address.
      emailVerified: apple.emailVerified,
      displayName: null,
      avatarUrl: null,
    },
    userAgent,
  );
}

type ProviderIdentity = {
  provider: "google" | "apple";
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * The three cases, shared by every provider.
 *
 * Shared rather than copied because case 2 is the one that must be got right, and two copies of a
 * security decision are two chances to get it wrong in only one of them.
 */
async function signInWithIdentity(
  identity: ProviderIdentity,
  userAgent?: string | null,
): Promise<IssuedSession & { isNew: boolean }> {
  const { provider } = identity;

  // 1. Known identity.
  const existing = await db.identity.findUnique({
    where: { provider_subject: { provider, subject: identity.subject } },
    include: { profile: { select: { id: true, email: true, role: true, suspendedAt: true } } },
  });

  if (existing) {
    if (existing.profile.suspendedAt) {
      throw new AppError("FORBIDDEN", "This account has been suspended.");
    }
    await db.$transaction([
      db.identity.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), email: identity.email },
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
  if (identity.email && identity.emailVerified) {
    const byEmail = await db.profile.findFirst({
      where: { email: { equals: identity.email, mode: "insensitive" } },
      select: { id: true, email: true, role: true, suspendedAt: true },
    });
    if (byEmail) {
      if (byEmail.suspendedAt) throw new AppError("FORBIDDEN", "This account has been suspended.");
      await db.$transaction([
        db.identity.create({
          data: {
            profileId: byEmail.id,
            provider,
            subject: identity.subject,
            email: identity.email,
          },
        }),
        db.profile.update({ where: { id: byEmail.id }, data: { lastSignInAt: new Date() } }),
      ]);
      logger.info("identity.linked", { profileId: byEmail.id, provider });
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
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      lastSignInAt: new Date(),
      identities: {
        create: { provider, subject: identity.subject, email: identity.email },
      },
    },
    select: { id: true, email: true, role: true },
  });
  logger.info("identity.created", { profileId: profile.id, provider });

  return {
    ...(await issueSession(profile, userAgent)),
    isNew: true,
  };
}
