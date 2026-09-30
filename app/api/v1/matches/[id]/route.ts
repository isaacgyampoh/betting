import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getMatchDetail } from "@/lib/services/stats";

export const GET = route<RouteContext<"/api/v1/matches/[id]">>(async (req, { params }) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "We couldn't find that match.");
  return ok(await getMatchDetail(user, id.data));
});
