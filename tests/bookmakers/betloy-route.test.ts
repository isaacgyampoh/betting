import { describe, expect, it, vi } from "vitest";
import { createBetloyRoute, resolveEndpoint } from "@/lib/bookmakers/providers/betloy";
import { CASES } from "../../scripts/provider-eval";

/**
 * The Betloy route, against documented fixtures.
 *
 * **These are mocks.** No account exists and no request has ever been sent: creating an account is
 * the owner's decision. Every response here is built from the contract published at betloy.com/api
 * on 2026-10-18, so these prove the route behaves correctly *given that contract* and nothing
 * about whether Betloy works.
 *
 * The behaviour worth most attention is [resolveEndpoint]. Betloy addresses bookmakers by numeric
 * id, looked up from a free endpoint that carries a region - which means, unlike Convat, the
 * country can be expressed. The whole value of that is lost if an ambiguous lookup silently picks
 * a row, so most of what follows is about refusing to.
 */

const GH_MSPORT = { brand: "MSport", country: "GH" };
const GH_SPORTY = { brand: "SportyBet", country: "GH" };
const NG_SPORTY = { brand: "SportyBet", country: "NG" };

const LIST = [
  { id: 1, key: "sportybet_gh", name: "SportyBet Ghana", region: "GH" },
  { id: 2, key: "sportybet_ng", name: "SportyBet Nigeria", region: "NG" },
  { id: 3, key: "msport", name: "MSport", region: "GH" },
  { id: 4, key: "betpawa_gh", name: "betPawa Ghana", region: "GH" },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function okConvert(over: { data?: Record<string, unknown>; [k: string]: unknown } = {}) {
  const { data: dataOver, ...rest } = over;
  return {
    success: true,
    message: "Converted",
    ...rest,
    data: {
      conversion_id: "c-1",
      original_code: "MS123X",
      converted_code: "SB77QQ",
      from_bookie: "MSport",
      to_bookie: "SportyBet Ghana",
      total_odds: 3.42,
      number_of_events: 2,
      status: "completed",
      legs: [
        { event: "Arsenal vs Chelsea", market: "1X2", selection: "Arsenal", source_odds: 1.85, target_odds: 1.83 },
        { event: "Spurs vs Everton", market: "Over/Under", selection: "Over", line: "2.5", source_odds: 1.85 },
      ],
      flagged: [],
      ...(dataOver ?? {}),
    },
  };
}

/** Answers /bookmakers then /convert, in that order. */
function routeWith(convertResponse: () => Response, opts: { list?: unknown } = {}) {
  const fetchImpl = vi.fn((url: string) =>
    String(url).includes("/bookmakers")
      ? json(opts.list ?? { data: LIST })
      : String(url).includes("/usage")
        ? json({ data: { used: 0, remaining: 10 } })
        : convertResponse(),
  );
  const route = createBetloyRoute({ apiKey: "test-key-not-real", fetchImpl: fetchImpl as never });
  return { route, fetchImpl };
}

describe("resolving a bookmaker to the right market", () => {
  it("finds the brand in the country asked for", () => {
    expect(resolveEndpoint(LIST, GH_SPORTY)).toEqual({ id: 1 });
    expect(resolveEndpoint(LIST, NG_SPORTY)).toEqual({ id: 2 });
  });

  it("does not confuse two markets of the same brand", () => {
    // The failure this prevents: a Ghana slip converted at Nigerian prices, with the right teams
    // on it and nothing on screen to show anything went wrong.
    const gh = resolveEndpoint(LIST, GH_SPORTY);
    const ng = resolveEndpoint(LIST, NG_SPORTY);
    expect(gh).not.toEqual(ng);
  });

  it("refuses a brand with no row for that country rather than guessing", () => {
    const r = resolveEndpoint(LIST, { brand: "MSport", country: "NG" });
    expect(r).toHaveProperty("error");
    expect((r as { error: string }).error).toContain("refusing rather than guessing");
  });

  it("refuses a single unlabelled row, because it could be any market", () => {
    const r = resolveEndpoint([{ id: 9, name: "Betway", region: null }], { brand: "Betway", country: "GH" });
    expect(r).toHaveProperty("error");
  });

  it("refuses when several rows match the same country", () => {
    const dupes = [
      { id: 1, name: "SportyBet Ghana", region: "GH" },
      { id: 5, name: "SportyBet GH Mirror", region: "GH" },
    ];
    const r = resolveEndpoint(dupes, GH_SPORTY);
    expect(r).toHaveProperty("error");
    expect((r as { error: string }).error).toContain("cannot choose one");
  });

  it("says plainly when Betloy does not list the brand at all", () => {
    const r = resolveEndpoint(LIST, { brand: "Soccabet", country: "GH" });
    expect((r as { error: string }).error).toContain("does not list");
  });
});

describe("the Betloy route (documented fixtures, never the real service)", () => {
  it("is unconfigured, not broken, without a key", async () => {
    const route = createBetloyRoute({ apiKey: "" });
    expect(route.configured).toBe(false);
    await expect(
      route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps the key in the Authorization header and nowhere else", async () => {
    const { route, fetchImpl } = routeWith(() => json(okConvert()));
    await route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" });
    for (const call of fetchImpl.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key-not-real");
      if (init.body) expect(String(init.body)).not.toContain("test-key-not-real");
    }
  });

  it("looks the bookmakers up before converting, and sends their numeric ids", async () => {
    const { route, fetchImpl } = routeWith(() => json(okConvert()));
    await route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" });

    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("/bookmakers");
    const convert = fetchImpl.mock.calls.find((c) => String(c[0]).includes("/convert"))!;
    const init = (convert as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      booking_code: "MS123X",
      from_bookie_id: 3,
      to_bookie_id: 1,
    });
  });

  it("refuses an unresolvable market without sending a conversion", async () => {
    const { route, fetchImpl } = routeWith(() => json(okConvert()));
    await expect(
      route.convert({ from: { brand: "MSport", country: "NG" }, to: GH_SPORTY, code: "X", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/convert"))).toBe(false);
  });

  describe("what it must never do", () => {
    it("does not treat a 200 with no converted_code as a conversion", async () => {
      const { route } = routeWith(() => json(okConvert({ data: { converted_code: null } })));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "INVALID_CODE" });
    });

    it("refuses a code with zero events behind it", async () => {
      // PariPesa's failure: a coupon created, a code returned, nothing in it.
      const { route } = routeWith(() =>
        json(okConvert({ data: { number_of_events: 0, legs: [], flagged: [] } })),
      );
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    });

    it("passes the provider's own message through on failure instead of inventing one", async () => {
      const { route } = routeWith(() =>
        json({ success: false, message: "Booking code not recognised.", data: null }),
      );
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "NOPE", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ message: "Booking code not recognised." });
    });
  });

  describe("failure modes", () => {
    it("treats 402 as an exhausted allowance, which a retry cannot fix", async () => {
      const { route } = routeWith(() => json({ message: "credits exhausted" }, 402));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    });

    it("maps 429 to RATE_LIMITED", async () => {
      const { route } = routeWith(() => json({ message: "slow down" }, 429));
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    });

    it("treats an auth failure as ours, never as the user's bad code", async () => {
      const { route } = routeWith(() => json({ message: "bad key" }, 401));
      const err = await route
        .convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" })
        .catch((e) => e);
      expect(err.code).toBe("BOOKMAKER_NOT_CONNECTED");
      expect(err.message.toLowerCase()).not.toContain("code");
    });

    it("treats a timeout as indeterminate, and retries nothing on its own", async () => {
      let calls = 0;
      const fetchImpl = vi.fn((url: string) => {
        calls += 1;
        if (String(url).includes("/bookmakers")) return json({ data: LIST });
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      });
      const route = createBetloyRoute({ apiKey: "k", fetchImpl: fetchImpl as never });
      await expect(
        route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" }),
      ).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
      // One list call and one convert attempt. A blind retry could spend a credit, or book twice.
      expect(calls).toBe(2);
    });
  });

  describe("test mode", () => {
    it("appends ?test=true so a contract check costs nothing", async () => {
      const fetchImpl = vi.fn((url: string) =>
        String(url).includes("/bookmakers") ? json({ data: LIST }) : json(okConvert()),
      );
      const route = createBetloyRoute({ apiKey: "k", testMode: true, fetchImpl: fetchImpl as never });
      await route.convert({ from: GH_MSPORT, to: GH_SPORTY, code: "MS123X", idempotencyKey: "k1" });
      for (const [url] of fetchImpl.mock.calls) {
        expect(String(url)).toContain("test=true");
      }
    });
  });
});

describe("the evaluation matrix", () => {
  it("is the eight cases the document describes", () => {
    expect(CASES).toHaveLength(8);
    expect(CASES.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("costs at most eight credits, one per case", () => {
    expect(CASES.reduce((n, c) => n + c.credits, 0)).toBe(8);
  });

  it("aims four cases at bookmakers we are actually blocked on", () => {
    const blocked = ["MSport", "Betway", "betPawa", "1xBet"];
    const inbound = CASES.filter((c) => blocked.includes(c.from.brand) && c.to.brand === "SportyBet");
    expect(inbound.length).toBeGreaterThanOrEqual(4);
  });

  it("includes the country case, which is the one that fails silently", () => {
    const crossCountry = CASES.find((c) => c.from.country !== c.to.country);
    expect(crossCountry).toBeDefined();
    expect(crossCountry!.pass.toLowerCase()).toContain("refused");
  });

  it("includes an idempotency repeat tied to a real earlier case", () => {
    const repeat = CASES.find((c) => c.repeatOf);
    expect(repeat).toBeDefined();
    expect(CASES.some((c) => c.n === repeat!.repeatOf)).toBe(true);
  });

  it("carries no booking codes in source control", () => {
    // Real codes belong in the operator's environment, not in a repository.
    for (const c of CASES) expect(c.code).toBeUndefined();
  });
});
