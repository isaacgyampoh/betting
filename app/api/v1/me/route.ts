import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getMe } from "@/lib/services/profile";

export const GET = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  return ok(await getMe(user));
});
