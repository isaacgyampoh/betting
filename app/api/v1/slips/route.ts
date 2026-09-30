import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listRecentSlips } from "@/lib/services/slips";

const limitSchema = z.coerce.number().int().min(1).max(50).catch(10);

export const GET = route(async (req) => {
  const user = await requireUser(req.headers.get("authorization"));
  const limit = limitSchema.parse(req.nextUrl.searchParams.get("limit") ?? undefined);
  return ok(await listRecentSlips(user, limit));
});
