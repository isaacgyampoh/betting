import { ok, route } from "@/lib/api";
import { getAuthUser } from "@/lib/auth";
import { getTodaysPicks } from "@/lib/services/daily-picks";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await getAuthUser(req.headers.get("authorization"));
  return ok(await getTodaysPicks(user?.id ?? null));
});
