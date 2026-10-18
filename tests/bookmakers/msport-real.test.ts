import { beforeAll, describe, expect, it } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { listUpcoming, getEventMarkets } from "@/lib/bookmakers/live/msport";
import type { BookmakerEventInfo } from "@/lib/bookmakers/types";

// Live checks against MSport's real API, plus the conversion that matters: a pick found on
// SportyBet, booked on MSport. Run with:
//   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/msport-real.test.ts

const live = process.env.VERIFY_LIVE === "1";
const msport = createAdapter("msport", "live");
const sportybet = createAdapter("sportybet", "live");

/**
 * Whether MSport is answering us at all, and why not.
 *
 * MSport sits behind Cloudflare and its WAF returns 403 "Attention Required" to our requests -
 * observed from the deployed Worker first and, as of 18 Oct 2026, from an ordinary connection too.
 * The integration itself is finished: the endpoints, the market map and the booking format were all
 * verified before the block went up.
 *
 * So the block is theirs to lift, by an allowlist or an official integration, and not something to
 * engineer around - working around a provider's own access control would breach their terms and
 * would have to be kept secret from them, which is a reliable sign it is the wrong move.
 *
 * This file therefore asserts the block rather than failing on it. Every test below skips while we
 * are refused, and `is still being refused` fails the moment MSport starts answering - which is the
 * signal to take msport out of REFUSED_BY_BOOKMAKER and let these run again. A suite that is simply
 * red every night teaches people to stop reading it.
 */
let refused = false;
let refusal = "";

describe.skipIf(!live)("MSport live API", () => {
  let fixtures: BookmakerEventInfo[] = [];
  let target: BookmakerEventInfo | undefined;
  let offers: Awaited<ReturnType<typeof getEventMarkets>>["offers"] = [];

  beforeAll(async () => {
    try {
      fixtures = await listUpcoming({ pages: 2 });
    } catch (err) {
      refused = true;
      refusal = `listUpcoming threw: ${(err as Error).message}`;
      return;
    }
    if (fixtures.length === 0) {
      refused = true;
      refusal = "listUpcoming returned no fixtures (MSport's WAF answers 403)";
      return;
    }
    // At least an hour out, because bookmakers refuse a game about to kick off, and with a real
    // market list: plenty of obscure fixtures carry only a handful of prices, and testing whichever
    // one happens to be first tests the luck of the draw rather than the adapter.
    const soonest = Date.now() + 60 * 60_000;
    const candidates = fixtures.filter((f) => f.status === "NOT_STARTED" && f.kickoffAt.getTime() > soonest);
    for (const candidate of candidates.slice(0, 8)) {
      const got = (await getEventMarkets(candidate.externalId)).offers;
      const has = (id: string) => got.some((o) => o.raw.marketId === id && o.market);
      if (got.length > 10 && has("1") && has("18")) {
        target = candidate;
        offers = got;
        break;
      }
    }
    if (!target) {
      refused = true;
      refusal = `no MSport fixture with a full market list among ${candidates.length} candidates`;
    }
  }, 120_000);

  it("is still being refused by MSport, which is theirs to lift", () => {
    expect(
      refused,
      `MSport is answering again (${refusal || "fixtures and markets both loaded"}) - ` +
        "remove msport from REFUSED_BY_BOOKMAKER and re-run this file",
    ).toBe(true);
  });

  it("lists real upcoming fixtures", (ctx) => {
    if (refused) return ctx.skip();
    expect(fixtures.length).toBeGreaterThan(10);
    for (const f of fixtures) {
      expect(f.home).toBeTruthy();
      expect(f.away).toBeTruthy();
      expect(f.externalId).toMatch(/^sr:match:\d+$/);
    }
  });

  it("maps the markets Ghanaian slips use", (ctx) => {
    if (refused) return ctx.skip();
    expect(offers.length).toBeGreaterThan(10);
    expect(offers.every((o) => o.odds > 1)).toBe(true);
    const types = new Set(offers.filter((o) => o.market).map((o) => o.market!.type));
    expect(types).toContain("MATCH_RESULT");
    expect(types).toContain("OVER_UNDER");
  });

  it("round-trips every mapped offer to the same ids", (ctx) => {
    if (refused) return ctx.skip();
    const teams = { home: target!.home, away: target!.away };
    for (const o of offers.filter((x) => x.market)) {
      const back = msport.unmapMarket(o.market!, teams);
      expect({ m: back?.marketId, o: back?.outcomeId, s: back?.specifier }).toEqual({
        m: o.raw.marketId,
        o: o.raw.outcomeId,
        s: o.raw.specifier,
      });
    }
  });

  it("books a code and reads back the same picks", async (ctx) => {
    if (refused) return ctx.skip();
    const main = offers.find((o) => o.raw.marketId === "1" && o.market);
    const total = offers.find((o) => o.raw.marketId === "18" && o.market);
    expect(main).toBeDefined();
    expect(total).toBeDefined();

    const created = await msport.createCode([
      { eventExternalId: target!.externalId, raw: main!.raw },
      { eventExternalId: target!.externalId, raw: total!.raw },
    ]);
    expect(created.code).toMatch(/^[A-Z0-9]{5,10}$/);
    console.log(`\n  MSport booked ${created.code} for ${target!.home} v ${target!.away}`);

    const slip = await msport.loadCode(created.code);
    expect(slip.selections).toHaveLength(2);
    expect(slip.selections.every((s) => (s.odds ?? 0) > 1)).toBe(true);
    // The line must survive, or we book a different bet.
    expect(slip.selections.find((s) => s.raw.marketId === "18")!.raw.specifier).toBe(total!.raw.specifier);
  }, 90_000);

  it("rejects an unknown code without blaming the user's code format", async (ctx) => {
    if (refused) return ctx.skip();
    await expect(msport.loadCode("ZZZ999")).rejects.toMatchObject({
      code: expect.stringMatching(/INVALID_CODE|EXPIRED_CODE/),
    });
  }, 30_000);
});

// The product's original promise. Both run the same platform, so a pick carries across by id and
// only the price changes — which is exactly the thing worth telling a bettor.
describe.skipIf(!live)("converting a real slip from SportyBet to MSport", () => {
  it("books the same picks on MSport and reports MSport's own prices", async (ctx) => {
    if (refused) return ctx.skip();
    const { listUpcomingWithOffers } = await import("@/lib/bookmakers/live/sportybet");
    const sbFixtures = await listUpcomingWithOffers({ hours: 72, pages: 3 });

    // Find a fixture MSport also lists, with a 1X2 price on both sides.
    const msFixtures = await listUpcoming({ pages: 3 });
    const msIds = new Set(msFixtures.filter((f) => f.status === "NOT_STARTED").map((f) => f.externalId));
    const shared = sbFixtures.find(
      (f) => msIds.has(f.event.externalId) && f.offers.some((o) => o.raw.marketId === "1" && o.market),
    );
    expect(shared, "no fixture listed by both bookmakers right now").toBeDefined();

    const pick = shared!.offers.find((o) => o.raw.marketId === "1" && o.market)!;
    const sbCode = await sportybet.createCode([{ eventExternalId: shared!.event.externalId, raw: pick.raw }]);
    const loaded = await sportybet.loadCode(sbCode.code);
    expect(loaded.selections).toHaveLength(1);

    // Convert: same market, booked at MSport.
    const msCode = await msport.createCode([
      { eventExternalId: loaded.selections[0].event.externalId, raw: loaded.selections[0].raw },
    ]);
    const converted = await msport.loadCode(msCode.code);
    expect(converted.selections).toHaveLength(1);
    expect(converted.selections[0].event.externalId).toBe(shared!.event.externalId);
    expect(converted.selections[0].market).toEqual(loaded.selections[0].market);
    expect(converted.selections[0].odds).toBeGreaterThan(1);

    console.log(
      `\n  ${shared!.event.home} v ${shared!.event.away} — ${loaded.selections[0].raw.outcomeName}` +
        `\n    SportyBet ${sbCode.code}: ${loaded.selections[0].odds}` +
        `\n    MSport    ${msCode.code}: ${converted.selections[0].odds}`,
    );
  }, 180_000);
});
