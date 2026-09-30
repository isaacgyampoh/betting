import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { getAiAllowance } from "@/lib/services/ai-quota";

export const GET = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  return ok(await getAiAllowance(user.id));
});
