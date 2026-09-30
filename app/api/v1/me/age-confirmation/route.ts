import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { confirmAge, getMe } from "@/lib/services/profile";

const bodySchema = z.object({
  confirmedOver18: z.literal(true),
  acceptedTerms: z.literal(true),
});

export const POST = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  await parseBody(req, bodySchema);
  await confirmAge(user);
  return ok(await getMe(user));
});
