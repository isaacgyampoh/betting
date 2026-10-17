import "server-only";
import type { AuthUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/bookmakers/registry";
import { isBookmakerSlug } from "@/lib/bookmakers/registry";
import { getOwnedSlipRecord, toSlipView } from "@/lib/services/slips";
import type { SlipView } from "@/lib/slips/view";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";

export const SLIP_BOOK_LIMIT = { limit: 40, windowMs: 60 * 60_000 };

/**
 * Asks the bookmaker to issue a code for a draft that has already been converted.
 *
 * The split exists because the two halves fail for completely different reasons and only one of
 * them is worth repeating. Converting is the expensive part - finding each game at the
 * destination and reading its price - and once it has succeeded we are holding the answer.
 * Booking is a single write that the bookmaker can refuse for its own reasons. Doing them
 * together meant a refused booking threw away work that had already worked, and meant the user
 * found out how many of their selections could be carried only after committing to the move.
 *
 * Nothing here re-matches or re-prices. It books exactly the selections the draft already holds,
 * which is what makes "the code is these selections" a true statement rather than a hope.
 */
export async function bookSlip(opts: { user: AuthUser; slipId: string }): Promise<SlipView> {
  const { user, slipId } = opts;
  const slip = await getOwnedSlipRecord(user, slipId);

  if (slip.bookingCode) {
    // Already booked. Returning it rather than booking a second one: a double tap must not leave
    // the user with two codes at the bookmaker for the same slip.
    return toSlipView(slip);
  }

  const slug = slip.bookmaker.slug;
  if (!isBookmakerSlug(slug)) throw new AppError("BAD_REQUEST", "That bookmaker isn't supported.");

  // OK means the conversion found this game and this market at the destination and read a price
  // for it. Without the bookmaker's own event id there is nothing to book against, so a selection
  // missing one is not carryable however it is marked.
  const carryable = slip.selections.filter(
    (s) => s.status === "OK" && s.bookmakerEvent?.externalId && s.marketType && s.outcome,
  );
  if (carryable.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      `None of these selections are available on ${slip.bookmaker.name}, so there is nothing to book.`,
    );
  }

  await enforceRateLimit({ userId: user.id, kind: "SLIP_CONVERT", ...SLIP_BOOK_LIMIT });

  const adapter = getAdapter(slug);
  const created = await adapter
    .createCode(
      carryable.map((s) => ({
        eventExternalId: s.bookmakerEvent!.externalId,
        market: {
          type: s.marketType!,
          period: s.period,
          outcome: s.outcome!,
          line: s.line === null ? null : Number(s.line),
        },
      })),
    )
    .catch((err) => {
      logger.warn("book.refused", { slipId, bookmaker: slug, picks: carryable.length, err: String(err).slice(0, 300) });
      return null;
    });

  // `created.code`, not `created`. An adapter that resolves with an empty code is not a success,
  // and testing the wrapper rather than the code inside it wrote a null booking code to the slip
  // and returned 200 - which is the exact thing this whole split exists to prevent: reporting a
  // conversion as booked when the bookmaker issued nothing.
  if (!created?.code) {
    logger.warn("book.no_code", { slipId, bookmaker: slug, picks: carryable.length, got: JSON.stringify(created ?? null).slice(0, 200) });
    // The draft survives. Nothing is lost and nothing is claimed: the selections are still there,
    // still priced, and the user can try again or pick a different destination.
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      `${slip.bookmaker.name} wouldn't issue a code just now. Your selections are saved - try again in a moment.`,
    );
  }

  await db.slip.update({
    where: { id: slip.id },
    data: { bookingCode: created.code, expiresAt: created.expiresAt ?? null },
  });

  // Built from the record we already hold plus the code we just wrote, rather than read back.
  //
  // Reading it back returned the row as it was *before* the update - a slip with no code, served
  // with a 200, which is the single worst thing this endpoint could do: tell someone their slip
  // was booked and hand them nothing. Writes here go through Hyperdrive and a read immediately
  // after one has been seen to miss it (there is a longer note about the same behaviour in
  // lib/auth.ts, where it broke the 18+ gate). We do not need the round trip: the booking code is
  // what the bookmaker just told us, and nothing else about the slip changed.
  const updated = { ...slip, bookingCode: created.code, expiresAt: created.expiresAt ?? null };

  await logUsage({ userId: user.id, kind: "SLIP_CONVERT", success: true, meta: { op: "book", bookmaker: slug, picks: carryable.length } });
  logger.info("book.issued", { slipId, bookmaker: slug, picks: carryable.length });

  return toSlipView(updated as typeof slip);
}
