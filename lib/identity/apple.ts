import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError } from "@/lib/errors";

/**
 * Verifying an Apple ID token.
 *
 * The same shape as lib/identity/google.ts, and for the same reasons - signature against Apple's
 * published keys, issuer pinned, audience pinned, expiry enforced, email_verified required before
 * an address is ever used to find an existing account. What differs is Apple-specific and each
 * difference matters:
 *
 *   - **The audience is the bundle identifier.** For Sign in with Apple on a native iOS app, Apple
 *     stamps `aud` with the app's bundle id - `win.gameclaw.app` - not a separate client id the
 *     way Google does. A Services ID is only needed for the web flow, which this app does not use.
 *
 *   - **Email arrives once.** Apple returns `email` on the *first* authorization for an app and
 *     omits it on every subsequent sign-in. So `sub` is the only durable key, and any code that
 *     depends on the address being present on each sign-in is wrong. Ours does not.
 *
 *   - **`email_verified` is sometimes the string "true".** Apple has sent both a boolean and a
 *     string historically, exactly as Google has.
 *
 *   - **Private relay.** When the user hides their address, Apple issues a per-app relay address
 *     at privaterelay.appleid.com and sets `is_private_email`. Mail to it forwards, so it is a
 *     usable contact address, but it is not the address the person uses anywhere else - which has
 *     a consequence for account linking spelled out in sign-in.ts.
 *
 * No secret is involved here. Verifying an ID token needs only Apple's public keys; the client
 * secret in Apple's documentation is for the authorization-code exchange, which a native app that
 * only wants identity does not perform.
 */
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const ISSUER = "https://appleid.apple.com";

export type AppleIdentity = {
  /** Apple's stable subject id, unique per app per Apple Account. The identity itself. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** True when `email` is a per-app relay address that forwards to the real one. */
  isPrivateRelay: boolean;
};

/** Accepted audiences, comma-separated, exactly as `acceptedAudiences` does for Google. */
export function acceptedAppleAudiences(configured: string): string[] {
  return configured
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Whether a raw nonce matches the hash Apple stamped into the token.
 *
 * Exported as its own function so it can be tested. The check inside verifyAppleIdToken sits
 * behind jwtVerify, which no test can reach without a token signed by Apple's private key, so the
 * comparison that actually carries the security would otherwise go unexercised.
 *
 * Returns false rather than throwing: the caller decides what a mismatch means, and callers that
 * forget to check a boolean are easier to spot in review than a swallowed exception.
 */
export function nonceMatches(claimNonce: string, rawNonce: string | null | undefined): boolean {
  if (!rawNonce) return false;
  return createHash("sha256").update(rawNonce).digest("hex") === claimNonce;
}

export async function verifyAppleIdToken(
  idToken: string,
  audience: string,
  rawNonce?: string | null,
): Promise<AppleIdentity> {
  const audiences = acceptedAppleAudiences(audience);
  if (audiences.length === 0) {
    // Fail closed, for the reason google.ts fails closed: passing undefined to jwtVerify skips the
    // audience check altogether, turning a missing environment variable into an open door.
    throw new AppError("UNAUTHORIZED", "Sign in with Apple is not configured on this server.");
  }

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer: ISSUER,
      audience: audiences,
      clockTolerance: 60,
    }));
  } catch {
    // Deliberately not surfacing jose's reason, so a forgery attempt learns nothing about which
    // part to fix.
    throw new AppError("UNAUTHORIZED", "That Apple sign-in could not be verified.");
  }

  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) throw new AppError("UNAUTHORIZED", "That Apple sign-in could not be verified.");

  // Nonce, when the token carries one.
  //
  // The client invents a random value, sends Apple its SHA-256, and Apple stamps that hash into
  // the token. Sending us the original lets us recompute the hash and prove this token was minted
  // for *this* sign-in attempt rather than captured from another one and replayed.
  //
  // A token that carries a nonce we cannot check is refused rather than waved through. Accepting
  // it would mean the claim is decorative: an attacker replaying a stolen token would simply omit
  // the raw value and be trusted for it. Apple lets the nonce be omitted entirely, and a token
  // with no nonce claim is still valid - every other check still had to pass - so that case is
  // allowed, and the client is what decides to always send one.
  if (typeof claims.nonce === "string" && claims.nonce.length > 0) {
    if (!nonceMatches(claims.nonce, rawNonce)) {
      throw new AppError("UNAUTHORIZED", "That Apple sign-in could not be verified.");
    }
  }

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;

  return {
    subject,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    isPrivateRelay:
      claims.is_private_email === true ||
      claims.is_private_email === "true" ||
      (email?.endsWith("@privaterelay.appleid.com") ?? false),
  };
}
