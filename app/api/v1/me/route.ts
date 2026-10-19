import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteAccount } from "@/lib/services/account";
import { getMe } from "@/lib/services/profile";

export const GET = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok(await getMe(user));
});

/**
 * Deletes the signed-in account and everything belonging to it.
 *
 * Google Play requires this to exist in the app and at a web address, and requires that it
 * removes the data rather than marking the row inactive. `lib/services/account.ts` explains what
 * goes and what deliberately does not.
 *
 * No request body and no confirmation field. The confirmation belongs in the interface, where the
 * person can read what they are about to lose; a flag in a JSON body only proves the client sent
 * one. Every session is revoked as a consequence of deleting the account, because refresh tokens
 * cascade off the profile.
 */
export const DELETE = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok(await deleteAccount(user.id));
});
