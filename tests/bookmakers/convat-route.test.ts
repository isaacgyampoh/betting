import { describe, expect, it, vi } from "vitest";
import { createConvatRoute } from "@/lib/bookmakers/providers/convat";

/**
 * The Convat route, against documented fixtures.
 *
 * **These are mocks.** No request has ever been sent to Convat: getting a key means signing an
 * evaluation agreement, which is the owner's call. Every response below is built from the contract
 * published at convat.io/api on 2026-10-18, so these tests prove the route behaves correctly
 * *given that contract* - and nothing at all about whether Convat works.
 *
 * What they are really for is the set of behaviours that must hold before any key is ever used,
 * because the first real call is the one that could hand a user a code that books nothing.
 */

/**
 * The directions matter, and they are not symmetric.
 *
 * Convat's converter lists SportyBet in its "convert to" column only, so it cannot read a
 * SportyBet code. For GameClaw that means Convat covers the *inbound* direction - a bookmaker we
 * cannot read, converted into SportyBet - and not the outbound one. Since SportyBet Ghana is our
 * main source, that asymmetry decides most of what an evaluation is worth.
 */
const GH_MSPORT = { brand: "MSport", country: "GH" };   // claimed as both source and destination
const GH_SPORTY = { brand: "SportyBet", country: "GH" }; // claimed as a destination only
const GH_BETWAY = { brand: "Betway", country: "GH" };    // claimed as both
const NG_SPORTY = { brand: "SportyBet", country: "NG" };

/** A success shaped exactly like the documented response. */
function okBody(over: Record<string, unknown> = {}) {
  return {
    success: true,
    sourceBookie: "MSport",
    sourceCode: "ABC123",
    targetBookie: "SportyBet",
    targetCode: "SB99XK",
    matched: 2,
    total: 2,
    sourceOddsTotal: 3.42,
    targetOddsTotal: 3.38,
    matchedSelections: [
      {
        eventName: "Arsenal vs Chelsea",
        competition: "Premier League",
        market: "1X2",
        selection: "Arsenal",
        line: null,
        startDate: "2026-10-19T19:00:00Z",
        sourceOdds: 1.85,
        targetOdds: 1.83,
        lineAdjusted: false,
      },
      {
        eventName: "Spurs vs Everton",
        competition: "Premier League",
        market: "Over/Under",
        selection: "Over",
        line: "2.5",
        startDate: "2026-10-19T19:00:00Z",
        sourceOdds: 1.85,
        targetOdds: 1.85,
        lineAdjusted: true,
        bookedLine: "2.5",
      },
    ],
    unmatched: [],
    processingTimeMs: 2100,
    ...over,
  };
}

function routeWith(responder: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fetchImpl = vi.fn(responder as unknown as typeof fetch);
  const route = createConvatRoute({ apiKey: "test-key-not-real", fetchImpl: fetchImpl as never });
  return { route, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the Convat route (documented fixtures, never the real service)", () => {
  describe("configuration", () => {
    it("is unconfigured, not broken, when there is no key", () => {
      const route = createConvatRoute({ apiKey: "" });
      expect(route.configured).toBe(false);
      expect(route.supports(GH_MSPORT, GH_SPORTY)).toBe(false);
    });

    it("refuses to convert at all without a key, and says so as configuration", async () => {
      const route = createConvatRoute({ apiKey: "" });
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_NOT_CONNECTED" });
    });

    it("never puts the key anywhere but the Authorization header", async () => {
      const { route, fetchImpl } = routeWith(() => json(okBody()));
      await route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" });

      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-key-not-real");
      // Not in the body, where it would reach logs, analytics or a stored request.
      expect(String(init.body)).not.toContain("test-key-not-real");
    });
  });

  describe("which routes it will attempt", () => {
    it("accepts a pair both sides of which Convat claims, in one country", () => {
      const { route } = routeWith(() => json(okBody()));
      expect(route.supports(GH_MSPORT, GH_SPORTY)).toBe(true);
      expect(route.supports(GH_MSPORT, GH_BETWAY)).toBe(true);
    });

    it("refuses a cross-country pair until Convat says how a market is chosen", () => {
      // The request body has source, target and code - and no country. A Ghana slip converted
      // into a Nigeria code would book the right teams at the wrong country's prices and look
      // entirely correct on screen.
      const { route } = routeWith(() => json(okBody()));
      expect(route.supports(GH_MSPORT, NG_SPORTY)).toBe(false);
    });

    it("refuses converting a bookmaker to itself", () => {
      const { route } = routeWith(() => json(okBody()));
      expect(route.supports(GH_MSPORT, GH_MSPORT)).toBe(false);
    });

    it("refuses a destination Convat lists only as a source", () => {
      // Bet9ja appears in the 'convert from' list and not the 'convert to' list.
      const { route } = routeWith(() => json(okBody()));
      expect(route.supports(GH_MSPORT, { brand: "Bet9ja", country: "GH" })).toBe(false);
    });

    it("cannot read a SportyBet code, which is the asymmetry that decides the evaluation", () => {
      // SportyBet is destination-only on Convat's list. Our main source is SportyBet Ghana, so
      // Convat adds inbound coverage (a bookmaker we cannot read -> SportyBet) and nothing
      // outbound. Worth knowing before anyone signs an agreement.
      const { route } = routeWith(() => json(okBody()));
      expect(route.supports(GH_SPORTY, GH_BETWAY)).toBe(false);
      expect(route.supports(GH_MSPORT, GH_SPORTY)).toBe(true);
    });

    it("refuses an unsupported route before spending a request on it", async () => {
      const { route, fetchImpl } = routeWith(() => json(okBody()));
      await expect(
        route.convert({ from: GH_MSPORT, to: NG_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("a successful conversion", () => {
    it("returns the provider's code and both sides' odds, and nothing invented", async () => {
      const { route } = routeWith(() => json(okBody()));
      const r = await route.convert({
        from: GH_MSPORT,
        to: GH_SPORTY,
        code: "ABC123",
        idempotencyKey: "k1",
      });

      expect(r.targetCode).toBe("SB99XK");
      expect(r.matched).toHaveLength(2);
      expect(r.sourceOddsTotal).toBe(3.42);
      expect(r.targetOddsTotal).toBe(3.38);
      expect(r.routeId).toBe("convat");
      // Not in the documented response, so absent rather than guessed.
      expect(r.expiresAt).toBeNull();
    });

    it("carries a line the destination priced differently rather than hiding it", async () => {
      const { route } = routeWith(() => json(okBody()));
      const r = await route.convert({
        from: GH_MSPORT,
        to: GH_SPORTY,
        code: "ABC123",
        idempotencyKey: "k1",
      });
      expect(r.matched[1].lineAdjusted).toBe(true);
      expect(r.matched[1].line).toBe("2.5");
    });

    it("reports legs that did not carry across, with the provider's own reason", async () => {
      const { route } = routeWith(() =>
        json(
          okBody({
            matched: 1,
            total: 2,
            unmatched: [
              {
                eventName: "Spurs vs Everton",
                market: "Over/Under",
                selection: "Over 2.5",
                reason: "event_not_found",
                reasonText: "We couldn't find this game on SportyBet.",
              },
            ],
          }),
        ),
      );
      const r = await route.convert({
        from: GH_MSPORT,
        to: GH_SPORTY,
        code: "ABC123",
        idempotencyKey: "k1",
      });
      expect(r.unmatched).toHaveLength(1);
      expect(r.unmatched[0].reason).toBe("event_not_found");
      expect(r.unmatched[0].reasonText).toContain("couldn't find");
    });
  });

  describe("what it must never do", () => {
    it("does not treat HTTP 200 with no code as a conversion", async () => {
      // The whole point. A 200 is a response, not a booking code.
      const { route } = routeWith(() => json(okBody({ targetCode: null })));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "INVALID_CODE" });
    });

    it("does not accept a code with no selections behind it", async () => {
      // PariPesa's failure by another name: a coupon created, a code returned, nothing in it.
      const { route } = routeWith(() => json(okBody({ matched: 0, matchedSelections: [] })));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    });

    it("does not invent a code when the provider reports failure", async () => {
      const { route } = routeWith(() =>
        json({
          success: false,
          unmatched: [{ reason: "invalid_code", reasonText: "That booking code was not recognised." }],
        }),
      );
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "NOPE99", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "INVALID_CODE", message: "That booking code was not recognised." });
    });

    it("surfaces an unreadable body as an outage rather than a conversion", async () => {
      const { route } = routeWith(
        () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
      );
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    });
  });

  describe("failure modes", () => {
    it("maps a rate limit to RATE_LIMITED, whatever the published numbers turn out to be", async () => {
      const { route } = routeWith(() => json({ error: "slow down" }, 429));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    });

    it("treats an auth failure as ours, never as the user's or the bookmaker's", async () => {
      for (const status of [401, 403]) {
        const { route } = routeWith(() => json({ error: "bad key" }, status));
        const err = await route
          .convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" })
          .catch((e) => e);
        expect(err.code).toBe("BOOKMAKER_NOT_CONNECTED");
        // The user must not be told their code is wrong because our key is.
        expect(err.message.toLowerCase()).not.toContain("code");
      }
    });

    it("treats a timeout as an outage, not as a failed conversion", async () => {
      // A timeout may mean the provider booked and we never heard. The caller retries with the
      // same idempotency key; it must not be told the conversion failed.
      const { route } = routeWith(() => {
        throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
      });
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    });

    it("maps a server error to an outage", async () => {
      const { route } = routeWith(() => json({ error: "boom" }, 502));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    });
  });

  describe("idempotency", () => {
    it("sends the caller's key so a retry cannot book twice", async () => {
      const { route, fetchImpl } = routeWith(() => json(okBody()));
      await route.convert({
        from: GH_MSPORT,
        to: GH_SPORTY,
        code: "ABC123",
        idempotencyKey: "intent-7f3a",
      });
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("intent-7f3a");
    });

    it("sends the same key on a repeat of the same intent", async () => {
      const { route, fetchImpl } = routeWith(() => json(okBody()));
      const args = { from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "intent-7f3a" };
      await route.convert(args);
      await route.convert(args);
      const keys = fetchImpl.mock.calls.map(
        (c) => ((c[1] as RequestInit).headers as Record<string, string>)["idempotency-key"],
      );
      expect(keys).toEqual(["intent-7f3a", "intent-7f3a"]);
    });
  });

  describe("the request it actually sends", () => {
    it("posts the documented body to the documented path", async () => {
      const { route, fetchImpl } = routeWith(() => json(okBody()));
      await route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" });

      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://eval-api.convat.io/v1/convert");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        source: "MSport",
        target: "SportyBet",
        code: "ABC123",
      });
    });

    it("honours a base-url override, so an evaluation host is not baked in", async () => {
      const fetchImpl = vi.fn(() => json(okBody())) as unknown as typeof fetch;
      const route = createConvatRoute({
        apiKey: "k",
        baseUrl: "https://api.convat.io",
        fetchImpl,
      });
      await route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "ABC123", idempotencyKey: "k1" });
      expect((fetchImpl as never as { mock: { calls: [string][] } }).mock.calls[0][0]).toBe(
        "https://api.convat.io/v1/convert",
      );
    });
  });
});
