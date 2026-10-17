import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";
import { clientIpHash } from "@/lib/request";
import { convertSlip } from "@/lib/services/convert";

// `book` defaults false: converting should show what a destination can carry before anything is
// booked. Existing callers that want the old one-shot behaviour pass book: true.
const sourceSchema = z.union([
  z.object({ slipId: z.uuid(), target: z.enum(BOOKMAKER_SLUGS) }),
  z.object({ bookmaker: z.enum(BOOKMAKER_SLUGS).optional(), code: z.string().trim().min(1).max(40), target: z.enum(BOOKMAKER_SLUGS) }),
]);
const bodySchema = z.intersection(sourceSchema, z.object({ book: z.boolean().default(false) }));

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const body = await parseBody(req, bodySchema);
  const source = "slipId" in body ? { slipId: body.slipId } : { bookmaker: body.bookmaker, code: body.code };
  return ok(await convertSlip({ user, source, target: body.target, book: body.book, ipHash: clientIpHash(req) }));
});
