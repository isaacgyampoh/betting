import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getTeamPage } from "@/lib/services/directory";

export const GET = route<RouteContext<"/api/v1/teams/[id]">>(async (req, { params }) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "We couldn't find that team.");
  return ok(await getTeamPage(user, id.data));
});
