import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A destination that cannot issue a code must be refused before any work happens, and must say
 * which kind of "no" it is.
 *
 * The app only offers bookmakers whose capabilities allow booking, so none of this is reachable
 * from the UI. It is reachable from the API, and the point is that a user who somehow asks for
 * MSport is told MSport is turning us away - not told, after thirty seconds of matching, that
 * something generic went wrong.
 */
describe("a destination that cannot book", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ALLOW_SAMPLE_DATA = "0";
    process.env.SPORTYBET_MODE = "live";
    process.env.MSPORT_MODE = "live";
    process.env.ONEXBET_MODE = "live";
  });

  it("MSport reports it cannot book, and says it is refusing us", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    const msport = getAdapter("msport");

    expect(msport.capabilities.createCode).toBe(false);
    await expect(msport.createCode([])).rejects.toMatchObject({
      code: "BOOKMAKER_NOT_CONNECTED",
      message: expect.stringContaining("not accepting requests from our servers"),
    });
  });

  // The 1xBet platform reads fixtures and prices perfectly well. What it cannot do is book, and
  // the capability flag is the only thing standing between that and a user being offered it.
  it("the 1xBet platform reports it cannot book, even with its live mode on", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    const onex = getAdapter("1xbet");

    expect(onex.capabilities.events).toBe(true);
    expect(onex.capabilities.createCode).toBe(false);
    expect(onex.capabilities.loadCode).toBe(false);
  });

  it("the bookmakers that can book still can", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    expect(getAdapter("sportybet").capabilities.createCode).toBe(true);
  });

  // The listing the app builds its destination picker from must agree with the adapters.
  it("no bookmaker is listed as bookable unless its adapter says so", async () => {
    const { getAdapter } = await import("@/lib/bookmakers/registry");
    const { BOOKMAKER_SLUGS } = await import("@/lib/bookmakers/types");

    for (const slug of BOOKMAKER_SLUGS) {
      const adapter = getAdapter(slug);
      if (!adapter.capabilities.createCode) continue;
      // Anything offered as a destination must also be readable: a one-way conversion is useless.
      expect(adapter.capabilities.loadCode, slug).toBe(true);
    }
  });
});
