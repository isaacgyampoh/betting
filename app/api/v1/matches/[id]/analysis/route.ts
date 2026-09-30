import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { analyzeMatch } from "@/lib/ai/analysis";

export const maxDuration = 60;

export const POST = route<RouteContext<"/api/v1/matches/[id]/analysis">>(async (req, { params }) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "We couldn't find that match.");
  return ok(await analyzeMatch(user, id.data, req.nextUrl.searchParams.get("date") ?? undefined));
});
