import { describe, expect, it } from "vitest";
import { createAdapter, refusedByBookmaker, AWAITING_SETUP, REFUSED_BY_BOOKMAKER } from "@/lib/bookmakers/registry";

/**
 * What a finished integration does while the bookmaker is turning us away.
 *
 * Some bookmakers refuse our origin outright - MSport's WAF answered 403 to everything from 18
 * October until some time before 6 November. The product's job is to say so, not to engineer
 * around it: working past a provider's own access control would breach their terms and would have
 * to be kept from them.
 *
 * This tests the wrapper rather than whichever bookmaker is currently blocked. The previous
 * version used MSport, and when MSport started answering again five tests failed that had nothing
 * to do with MSport - a suite tied to somebody else's outage.
 */
const REASON = "Example is not accepting requests from our servers at the moment.";

describe("a bookmaker that refuses our servers", () => {
  const refused = () => refusedByBookmaker(createAdapter("sportybet", "live"), REASON);

  it("reports no capabilities, even though its adapter is live", () => {
    expect(createAdapter("sportybet", "live").capabilities.loadCode).toBe(true);
    expect(refused().capabilities).toEqual({ loadCode: false, createCode: false, events: false });
  });

  it("says it is being refused, not that it was never built", async () => {
    await refused()
      .loadCode("ABC123")
      .then(
        () => expect.unreachable("should have refused"),
        (err: { code: string; message: string }) => {
          expect(err.code).toBe("BOOKMAKER_NOT_CONNECTED");
          expect(err.message).toContain("not accepting requests from our servers");
          // The distinction that matters to somebody holding a code that is perfectly valid.
          expect(err.message).not.toMatch(/finish connecting|coming soon/i);
          expect(err.message).toContain("Your code is fine");
        },
      );
  });

  it("will not book a code at a bookmaker that is turning us away", async () => {
    await expect(refused().createCode([])).rejects.toMatchObject({ code: "BOOKMAKER_NOT_CONNECTED" });
  });

  // Code detection is a pure function, so a pasted code is still recognised and named - which is
  // how the user gets told which bookmaker it belongs to and why it cannot be used.
  it("still recognises the code format it cannot serve", () => {
    const a = refused();
    expect(a.name).toBe("SportyBet");
    expect(a.normalizeCode("abc123")).toBeTruthy();
  });

  it("keeps reading fixtures when only booking is refused", async () => {
    // The 1xBet platform shape: it serves its feed perfectly and only declines to book, and that
    // reading is what lets a slip be priced against it.
    const pricing = refusedByBookmaker(createAdapter("1xbet", "live"), REASON, true);
    expect(pricing.capabilities.events).toBe(true);
    await expect(pricing.loadCode("ABC123")).rejects.toMatchObject({ code: "BOOKMAKER_NOT_CONNECTED" });
  });

  it("leaves the bookmakers that do answer us alone", () => {
    const sporty = createAdapter("sportybet", "live");
    expect(sporty.capabilities.loadCode).toBe(true);
    expect(sporty.capabilities.createCode).toBe(true);
  });

  // Empty is the healthy state, and the one we are in. A bookmaker listed here is one we have
  // measured as refusing us, not one we have assumed is.
  it("lists only bookmakers measured as refusing us", () => {
    expect(Object.keys(REFUSED_BY_BOOKMAKER)).toEqual([]);
    // The four that are built but cannot book belong in the other map, with a different message.
    expect(Object.keys(AWAITING_SETUP).sort()).toEqual(["1xbet", "22bet", "betwinner", "paripesa"]);
  });
});
