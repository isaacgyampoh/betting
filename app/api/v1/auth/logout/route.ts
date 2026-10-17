import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { revokeSession } from "@/lib/identity/session";

const schema = z.object({ refresh_token: z.string().trim().min(20).max(512) });

/**
 * Signs this device out.
 *
 * Succeeds for an unknown or already-revoked token rather than reporting it. Sign-out is not a
 * place to tell a caller whether a token was real: the user's intent is "end this session", and
 * that intent is satisfied either way. It also means a client that signs out twice, or after its
 * token has expired, does not show the user an error for having done nothing wrong.
 */
export const POST = route(async (req) => {
  const { refresh_token } = await parseBody(req, schema);
  await revokeSession(refresh_token);
  return ok({ signed_out: true });
});
