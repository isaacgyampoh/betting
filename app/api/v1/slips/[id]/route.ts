import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getSlip } from "@/lib/services/slips";

export const GET = route<RouteContext<"/api/v1/slips/[id]">>(async (req, { params }) => {
  const user = await requireUser(req.headers.get("authorization"));
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "Slip not found.");
  return ok(await getSlip(user, id.data));
});
