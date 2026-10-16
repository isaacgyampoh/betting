import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MSport's integration is finished and its endpoints answer 200 from an ordinary connection. From
 * the deployed Worker the identical request returns 403, every time, on every endpoint, while
 * SportyBet and Football.com answer the same Worker. That is MSport declining this origin.
 *
 * The product's job is to say so, not to engineer around it: working past a provider's own access
 * control would breach their terms and would have to be kept from them.
 */
describe("a bookmaker that refuses our servers", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ALLOW_SAMPLE_DATA = "0";
    process.env.SPORTYBET_MODE = "live";
    process.env.MSPORT_MODE = "live";
  });

  it("reports no capabilities, even though its adapter is live", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    const msport = getAdapter("msport");

    expect(msport.capabilities).toEqual({ loadCode: false, createCode: false, events: false });
  });

  it("says it is being refused, not that it was never built", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");

    await getAdapter("msport")
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
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    await expect(getAdapter("msport").createCode([])).rejects.toMatchObject({
      code: "BOOKMAKER_NOT_CONNECTED",
    });
  });

  it("leaves the bookmakers that do answer us alone", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    const sporty = getAdapter("sportybet");

    expect(sporty.capabilities.loadCode).toBe(true);
    expect(sporty.capabilities.createCode).toBe(true);
  });

  // Code detection is a pure function, so a pasted MSport code is still recognised and named -
  // which is how the user gets told which bookmaker it belongs to and why it cannot be used.
  it("still recognises the code format it cannot serve", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    expect(getAdapter("msport").name).toBe("MSport");
    expect(getAdapter("msport").slug).toBe("msport");
  });
});
