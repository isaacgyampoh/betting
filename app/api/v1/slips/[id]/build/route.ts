import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientIpHash } from "@/lib/request";
import { buildToTarget } from "@/lib/services/build-slip";

const bodySchema = z.object({ target: z.number().min(1.01).max(100_000), maxPicks: z.number().int().min(1).max(12).optional() });

export const POST = route<RouteContext<"/api/v1/slips/[id]/build">>(async (req, { params }) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "Slip not found.");
  const body = await parseBody(req, bodySchema);
  return ok(await buildToTarget({ user, slipId: id.data, target: body.target, maxPicks: body.maxPicks, ipHash: clientIpHash(req) }));
});
