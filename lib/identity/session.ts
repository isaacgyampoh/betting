import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * GameClaw's own sessions, replacing Supabase's.
 *
 * Two different things, on purpose:
 *
 *   - An **access token**: a short-lived signed JWT the app sends on every request. Stateless, so
 *     verifying it costs no database round trip - which matters, because every protected route
 *     does it and the app fires several requests on a cold start.
 *   - A **refresh token**: a long-lived opaque random string, stored only as a SHA-256 hash. Not
 *     a JWT, because a refresh token must be revocable, and a stateless token cannot be revoked.
 *
 * The access token's one-hour life is the window in which a suspended account can still act. That
 * is the price of stateless verification, and an hour is the usual trade. Sign-out and suspension
 * both kill the refresh token immediately, so the session ends within the hour either way.
 */
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_DAYS = 60;

const ISSUER = "gameclaw";
const AUDIENCE = "gameclaw-app";

export type SessionClaims = { id: string; email: string | null; role: UserRole };

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  profileId: string;
};

function secret(): Uint8Array {
  const value = env().AUTH_JWT_SECRET;
  if (!value || value.length < 32) {
    // Fail closed and loudly. A short or missing signing secret is a forgeable session, and the
    // failure is silent at every other layer.
    throw new AppError("UNAUTHORIZED", "Sessions are not configured on this server.");
  }
  return new TextEncoder().encode(value);
}

/** SHA-256, hex. WebCrypto so this works on Workers and under Node without a polyfill. */
async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 bytes of CSPRNG, base64url. Not a JWT: this one is opaque and revocable by design. */
function opaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signAccessToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

/**
 * Reads a caller out of an access token, or returns null.
 *
 * Null rather than throwing, because the public football pages call this on every request and a
 * missing or expired token there is ordinary, not exceptional.
 */
export async function readAccessToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") return null;
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      role: (payload.role === "ADMIN" ? "ADMIN" : "USER") as UserRole,
    };
  } catch {
    return null;
  }
}

/** A fresh pair, starting a new rotation family. */
export async function issueSession(
  claims: SessionClaims,
  userAgent?: string | null,
): Promise<IssuedSession> {
  const refreshToken = opaqueToken();
  await db.refreshToken.create({
    data: {
      profileId: claims.id,
      tokenHash: await hash(refreshToken),
      // A new sign-in starts its own family, so revoking one stolen session does not sign the
      // person out of their other devices.
      familyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });
  return {
    accessToken: await signAccessToken(claims),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    profileId: claims.id,
  };
}

/**
 * Exchanges a refresh token for a new pair, and detects theft.
 *
 * Rotation means the presented token is revoked and a new one issued. The old row is kept, not
 * deleted, so that presenting it a second time is *detectable* - and that is the whole point. A
 * refresh token that is used twice has been copied, because the legitimate holder threw theirs
 * away when it was rotated. There is no way to tell which of the two callers is the thief, so
 * the entire family is revoked and both are sent back to sign in. That is the correct outcome:
 * an inconvenience for the owner, and a dead end for whoever took it.
 */
export async function rotateSession(
  presented: string,
  userAgent?: string | null,
): Promise<IssuedSession> {
  const tokenHash = await hash(presented);
  const row = await db.refreshToken.findUnique({
    where: { tokenHash },
    include: { profile: { select: { id: true, email: true, role: true, suspendedAt: true } } },
  });

  if (!row) throw new AppError("UNAUTHORIZED", "Please sign in again.");

  if (row.revokedAt) {
    // Reuse. Burn the family; see above.
    await db.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError("UNAUTHORIZED", "Please sign in again.");
  }

  if (row.expiresAt <= new Date()) throw new AppError("UNAUTHORIZED", "Please sign in again.");
  if (row.profile.suspendedAt) throw new AppError("FORBIDDEN", "This account has been suspended.");

  const next = opaqueToken();
  await db.$transaction([
    db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } }),
    db.refreshToken.create({
      data: {
        profileId: row.profileId,
        tokenHash: await hash(next),
        familyId: row.familyId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
    }),
  ]);

  const claims: SessionClaims = {
    id: row.profile.id,
    email: row.profile.email,
    role: row.profile.role,
  };
  return {
    accessToken: await signAccessToken(claims),
    refreshToken: next,
    expiresIn: ACCESS_TTL_SECONDS,
    profileId: claims.id,
  };
}

/** Signs out one device. Unknown or already-revoked tokens succeed quietly. */
export async function revokeSession(presented: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { tokenHash: await hash(presented), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Signs out everywhere. Used by suspension and by "sign out of all devices". */
export async function revokeAllSessions(profileId: string): Promise<number> {
  const { count } = await db.refreshToken.updateMany({
    where: { profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}
