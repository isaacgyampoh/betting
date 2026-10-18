import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { isBookmakerSlug } from "@/lib/bookmakers/registry";
import { AppError } from "@/lib/errors";
import { clientIpHash } from "@/lib/request";
import { mergeSlips } from "@/lib/services/merge";

const bodySchema = z.object({
  target: z.string().min(1).max(40),
  picks: z
    .array(z.object({ slipId: z.uuid(), position: z.number().int().min(1).max(60) }))
    .min(2)
    .max(40),
  /**
   * Default false: a merge stops at a draft so the user can see what the destination could carry
   * before a code exists. Booking is a second, explicit step.
   */
  book: z.boolean().optional(),
});

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const body = await parseBody(req, bodySchema);
  if (!isBookmakerSlug(body.target)) {
    throw new AppError("BAD_REQUEST", "That bookmaker isn't supported yet.");
  }
  return ok(
    await mergeSlips({
      user,
      picks: body.picks,
      target: body.target,
      book: body.book ?? false,
      ipHash: clientIpHash(req),
    }),
  );
});
