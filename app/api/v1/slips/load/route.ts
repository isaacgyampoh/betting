import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";
import { clientIpHash } from "@/lib/request";
import { loadSlip } from "@/lib/services/slips";

const bodySchema = z.object({
  /** Omit to auto-detect the bookmaker from the code. */
  bookmaker: z.enum(BOOKMAKER_SLUGS).optional(),
  code: z.string().trim().min(1, "Enter a booking code.").max(40),
});

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const body = await parseBody(req, bodySchema);
  return ok(await loadSlip({ user, bookmaker: body.bookmaker, code: body.code, ipHash: clientIpHash(req) }));
});
