import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";
import { clientIpHash } from "@/lib/request";
import { convertSlip } from "@/lib/services/convert";

const bodySchema = z.union([
  z.object({ slipId: z.uuid(), target: z.enum(BOOKMAKER_SLUGS) }),
  z.object({ bookmaker: z.enum(BOOKMAKER_SLUGS).optional(), code: z.string().trim().min(1).max(40), target: z.enum(BOOKMAKER_SLUGS) }),
]);

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const body = await parseBody(req, bodySchema);
  const source = "slipId" in body ? { slipId: body.slipId } : { bookmaker: body.bookmaker, code: body.code };
  return ok(await convertSlip({ user, source, target: body.target, ipHash: clientIpHash(req) }));
});
