import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getResponsibleSettings, updateResponsibleSettings } from "@/lib/services/account-tools";

// Reachable during a break on purpose: someone taking a break must still manage their settings.
const bodySchema = z.object({
  spendNoteGhs: z.number().min(0).max(1_000_000).nullable().optional(),
  remindersOn: z.boolean().optional(),
  excludeDays: z.number().int().min(1).max(365).optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok(await getResponsibleSettings(user));
});

export const POST = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok(await updateResponsibleSettings(user, await parseBody(req, bodySchema)));
});
