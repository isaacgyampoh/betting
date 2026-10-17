import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { bookSlip } from "@/lib/services/book";

/**
 * Asks the bookmaker to issue a code for a draft that has already been converted.
 *
 * Separate from conversion on purpose: a user should see how many of their selections a
 * destination can actually carry before anything is booked in their name.
 */
export const POST = route<RouteContext<"/api/v1/slips/[id]/book">>(async (req, { params }) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "Slip not found.");
  return ok(await bookSlip({ user, slipId: id.data }));
});
