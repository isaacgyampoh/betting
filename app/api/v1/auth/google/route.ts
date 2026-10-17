import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { clientIpHash } from "@/lib/request";
import { signInWithGoogle } from "@/lib/identity/sign-in";
import { enforceRateLimit } from "@/lib/services/usage";

// A Google ID token is a JWT: three base64url segments. Bounded so a bad client cannot post a
// novel, and loose enough not to reject a longer one than today's.
const schema = z.object({ id_token: z.string().trim().min(40).max(8192) });

/**
 * Exchanges a Google ID token for a GameClaw session.
 *
 * This is what the app calls instead of Supabase's `/token?grant_type=id_token`. The response
 * shape deliberately matches what it already reads - `access_token`, `refresh_token`,
 * `expires_in` - so the client change is a base URL and a path, not a rewrite.
 *
 * Rate limited by address even though the token is verified cryptographically: verification is
 * cheap but not free, it reaches out to Google's key endpoint, and an unlimited unauthenticated
 * endpoint is an invitation regardless of how well it rejects.
 */
export const POST = route(async (req) => {
  const ipHash = clientIpHash(req);
  await enforceRateLimit({ ipHash, kind: "AUTH", limit: 20, windowMs: 10 * 60_000 });

  const { id_token } = await parseBody(req, schema);
  const session = await signInWithGoogle(id_token, req.headers.get("user-agent"));

  return ok({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: session.expiresIn,
    token_type: "bearer",
    is_new: session.isNew,
  });
});
