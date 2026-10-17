import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError } from "@/lib/errors";

/**
 * Verifying a Google ID token, properly.
 *
 * This is what replaces `supabase.auth.getClaims`. The app obtains an ID token from Google on the
 * device and sends it here; this is the only place that decides whether it is real.
 *
 * Every check below exists because skipping it breaks something specific:
 *
 *   - **Signature**, against Google's published keys. Without it anybody can mint a token for any
 *     account by typing JSON.
 *   - **Issuer**, pinned to Google's two spellings. They issue under both `accounts.google.com`
 *     and `https://accounts.google.com` and say to accept either; accepting anything else means
 *     accepting somebody else's tokens.
 *   - **Audience**, pinned to our own Web client id. This is the one people leave out and the one
 *     that matters most: a token Google issued for a *different* application is still a perfectly
 *     valid, correctly signed Google token. Without this check, any app whose users also use
 *     GameClaw could sign in as them.
 *   - **Expiry**, which jwtVerify enforces, with a small tolerance because phone clocks drift.
 *   - **email_verified**, because an unverified address must never link to an existing account.
 *     Linking on an unverified email is account takeover with extra steps.
 *
 * The key set is fetched from Google and cached by jose according to the response's cache headers,
 * so this is not a network round trip per sign-in.
 */
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleIdentity = {
  /** Google's stable subject id. The identity itself; it never changes for an account. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

/**
 * The audiences this server will accept, from a comma-separated `GOOGLE_WEB_CLIENT_ID`.
 *
 * More than one, because a client id is baked into every installed APK. Replacing the Web client
 * - which happens: this project's first one was deleted - would otherwise reject every build in
 * the field the moment the server moved on. Listing the old id alongside the new one lets the
 * installed apps keep working until they are updated.
 *
 * An empty list is a configuration error, not a permissive default; see below.
 */
export function acceptedAudiences(configured: string): string[] {
  return configured
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
): Promise<GoogleIdentity> {
  const audiences = acceptedAudiences(audience);
  if (audiences.length === 0) {
    // Fail closed. Passing undefined to jwtVerify skips the audience check entirely, which would
    // turn a missing environment variable into an open door.
    throw new AppError("UNAUTHORIZED", "Google sign-in is not configured on this server.");
  }

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ISSUERS,
      audience: audiences,
      clockTolerance: 60,
    }));
  } catch {
    // Deliberately not surfacing jose's reason: "expired" versus "wrong audience" versus "bad
    // signature" tells an attacker which part of their forgery to fix.
    throw new AppError("UNAUTHORIZED", "That Google sign-in could not be verified.");
  }

  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) throw new AppError("UNAUTHORIZED", "That Google sign-in could not be verified.");

  return {
    subject,
    email: typeof claims.email === "string" ? claims.email.toLowerCase() : null,
    // Google sends a boolean, but has historically also sent the string "true".
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}
