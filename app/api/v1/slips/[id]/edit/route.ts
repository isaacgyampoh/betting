import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientIpHash } from "@/lib/request";
import { editSlip } from "@/lib/services/edit";
import { editOpSchema } from "@/lib/slips/edit-schema";

const bodySchema = z.object({ op: editOpSchema, book: z.boolean().default(true) });

export const POST = route<RouteContext<"/api/v1/slips/[id]/edit">>(async (req, { params }) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "Slip not found.");
  const body = await parseBody(req, bodySchema);
  return ok(await editSlip({ user, slipId: id.data, op: body.op, book: body.book, ipHash: clientIpHash(req) }));
});
