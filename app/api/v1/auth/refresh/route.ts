import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { clientIpHash } from "@/lib/request";
import { rotateSession } from "@/lib/identity/session";
import { enforceRateLimit } from "@/lib/services/usage";

const schema = z.object({ refresh_token: z.string().trim().min(20).max(512) });

/**
 * Exchanges a refresh token for a new pair.
 *
 * The old token is revoked here, always. The app already serialises its refreshes - six screens
 * loading at once would otherwise fire six refreshes with the same token - and that matters more
 * now, not less, because presenting a rotated token twice is treated as theft and kills every
 * session in the family. See lib/identity/session.ts.
 */
export const POST = route(async (req) => {
  await enforceRateLimit({ ipHash: clientIpHash(req), kind: "AUTH", limit: 60, windowMs: 10 * 60_000 });
  const { refresh_token } = await parseBody(req, schema);
  const session = await rotateSession(refresh_token, req.headers.get("user-agent"));
  return ok({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: session.expiresIn,
    token_type: "bearer",
  });
});
