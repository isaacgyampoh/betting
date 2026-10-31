import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { clientIpHash } from "@/lib/request";
import { signInWithApple } from "@/lib/identity/sign-in";
import { enforceRateLimit } from "@/lib/services/usage";

// An Apple ID token is a JWT, same three base64url segments as Google's. Bounded for the same
// reason: so a bad client cannot post a novel.
const schema = z.object({
  id_token: z.string().trim().min(40).max(8192),
  // The unhashed nonce the client sent Apple as a SHA-256. Optional only because a token without
  // a nonce claim is still valid; when the token has one, apple.ts refuses without this.
  raw_nonce: z.string().trim().min(8).max(256).optional(),
});

/**
 * Exchanges an Apple ID token for a GameClaw session.
 *
 * Deliberately the same shape as /auth/google - same request field, same response keys - so the
 * app's two sign-in paths differ by a URL and nothing else.
 *
 * Rate limited by address like its sibling. Verification is cryptographic but not free, it reaches
 * Apple's key endpoint, and an unlimited unauthenticated endpoint is an invitation regardless of
 * how well it rejects.
 */
export const POST = route(async (req) => {
  const ipHash = clientIpHash(req);
  await enforceRateLimit({ ipHash, kind: "AUTH", limit: 20, windowMs: 10 * 60_000 });

  const { id_token, raw_nonce } = await parseBody(req, schema);
  const session = await signInWithApple(id_token, req.headers.get("user-agent"), raw_nonce);

  return ok({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: session.expiresIn,
    token_type: "bearer",
    is_new: session.isNew,
  });
});
