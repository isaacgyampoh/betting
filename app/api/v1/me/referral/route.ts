import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult, requireUser } from "@/lib/auth";
import { applyReferral, getReferralSummary } from "@/lib/services/account-tools";

export const GET = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok(await getReferralSummary(user));
});

/** Applies someone else's code to this (new) account. */
export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const { code } = await parseBody(req, z.object({ code: z.string().trim().min(4).max(12) }));
  return ok(await applyReferral(user, code));
});
