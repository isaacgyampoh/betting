import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/bookmakers/registry";
import { convertSlip } from "@/lib/services/convert";
import { bookSlip } from "@/lib/services/book";
import { loadSlip } from "@/lib/services/slips";
import { createUser } from "./helpers";

/**
 * Converting and booking are two different things and fail for different reasons.
 *
 * Converting is the expensive half - finding each game at the destination and reading its price -
 * and once it has worked we are holding the answer. Booking is one write the bookmaker can refuse.
 * Doing them together meant a refused booking threw away work that had already succeeded, and meant
 * a user learned how many of their selections could be carried only after committing to the move.
 */
describe("a conversion that stops at the draft", () => {
  it("does every matching step and issues no code", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });

    const draft = await convertSlip({ user, source: { slipId: source.id }, target: "betway", book: false, ipHash: null });

    expect(draft.code).toBeNull();
    expect(draft.bookmaker.slug).toBe("betway");
    // The informative part has still happened: every selection carries a verdict and a price.
    expect(draft.selectionCount).toBe(7);
    expect(draft.selections.filter((s) => s.status === "OK").length).toBeGreaterThan(0);
    expect(draft.selections.find((s) => s.status === "OK")?.odds).toEqual(expect.any(Number));
  });

  it("says which selections the destination could not carry, and why", async () => {
    const user = await createUser();
    const draft = await convertSlip({
      user,
      source: { bookmaker: "sportybet", code: "BCLIVE" },
      target: "betway",
      book: false,
      ipHash: null,
    });

    const statuses = Object.fromEntries(draft.selections.map((s) => [s.position, s.status]));
    expect(statuses).toEqual({ 1: "EVENT_STARTED", 2: "OK", 3: "OK", 4: "UNSUPPORTED_MARKET" });
    expect(draft.code).toBeNull();
  });

  it("books the draft afterwards, against the selections it already holds", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const draft = await convertSlip({ user, source: { slipId: source.id }, target: "betway", book: false, ipHash: null });
    const carryable = draft.selections.filter((s) => s.status === "OK").length;

    const booked = await bookSlip({ user, slipId: draft.id });

    expect(booked.id).toBe(draft.id);
    expect(booked.code).toEqual(expect.any(String));
    // The code is these selections, not a re-run that might have found different ones.
    const atBookmaker = await getAdapter("betway").loadCode(booked.code!);
    expect(atBookmaker.selections).toHaveLength(carryable);
  });

  // A double tap must not leave somebody holding two codes at the bookmaker for one slip.
  it("booking twice returns the same code rather than issuing another", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const draft = await convertSlip({ user, source: { slipId: source.id }, target: "betway", book: false, ipHash: null });

    const first = await bookSlip({ user, slipId: draft.id });
    const second = await bookSlip({ user, slipId: draft.id });

    expect(second.code).toBe(first.code);
    const codes = await db.slip.count({ where: { parentSlipId: source.id, bookingCode: { not: null } } });
    expect(codes).toBe(1);
  });

  it("refuses to book a draft where nothing could be carried", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const draft = await convertSlip({ user, source: { slipId: source.id }, target: "betway", book: false, ipHash: null });
    // Mark every selection as uncarryable, the way a destination with none of these games would.
    await db.selection.updateMany({ where: { slipId: draft.id }, data: { status: "EVENT_NOT_FOUND" } });

    await expect(bookSlip({ user, slipId: draft.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("will not book somebody else's slip", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const source = await loadSlip({ user: owner, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const draft = await convertSlip({ user: owner, source: { slipId: source.id }, target: "betway", book: false, ipHash: null });

    await expect(bookSlip({ user: stranger, slipId: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // The default is unchanged for callers that already asked for the one-shot behaviour.
  it("still books in one step when asked to", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const converted = await convertSlip({ user, source: { slipId: source.id }, target: "betway", book: true, ipHash: null });
    expect(converted.code).toEqual(expect.any(String));
  });
});
