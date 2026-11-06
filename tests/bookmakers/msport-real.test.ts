import { beforeAll, describe, expect, it } from "vitest";
import { createAdapter, REFUSED_BY_BOOKMAKER } from "@/lib/bookmakers/registry";
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
 * MSport's WAF answered 403 to everything from 18 October. As of 2026-11-06 it serves us again -
 * 400 fixtures, 266 markets on one of them with 113 mapped - so it is out of REFUSED_BY_BOOKMAKER
 * and these run for real.
 *
 * The gate below stays, because the block may come back and a suite that is simply red every
 * night teaches people to stop reading it. It is narrower than it was: it used to conclude
 * "refused" when it could not find a fixture at least an hour out, and MSport's feed returns the
 * live window - 304 of 400 already in play, none more than twenty minutes away - so it reported a
 * block that had already lifted. Not finding a convenient fixture is not a refusal.
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
    // Only an empty feed means refused. Everything past here is about finding a fixture worth
    // testing against, and failing at that is this test's problem, not MSport's.
    // At least an hour out, because bookmakers refuse a game about to kick off, and with a real
    // market list: plenty of obscure fixtures carry only a handful of prices, and testing whichever
    // one happens to be first tests the luck of the draw rather than the adapter.
    // Not started is the requirement; "an hour out" was not. MSport's feed is the live window, so
    // asking for an hour's notice found nothing at all and looked like a block.
    //
    // Furthest kick-off first, because a bookmaker refuses to book a game about to start and the
    // feed is ordered soonest-first - taking the head of it picked a fixture minutes away and the
    // booking test failed on a game that was simply too close.
    const candidates = fixtures
      .filter((f) => f.status === "NOT_STARTED")
      .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());
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
      // Deliberately not a refusal: the feed answered, we just did not find a fixture carrying
      // both markets this test wants. Left as a skip with the reason attached.
      refusal = `no MSport fixture with a full market list among ${candidates.length} candidates`;
    }
  }, 120_000);

  it("is answering us, and is not in the refusal map", () => {
    expect(refused, `MSport appears to be refusing us again (${refusal}) - put it back in REFUSED_BY_BOOKMAKER`).toBe(
      false,
    );
    expect(REFUSED_BY_BOOKMAKER.msport).toBeUndefined();
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
    // A game minutes from kick-off is refused by the bookmaker, which is correct of it and not
    // something this test can assert around.
    const minutesOut = (target!.kickoffAt.getTime() - Date.now()) / 60_000;
    if (minutesOut < 15) return ctx.skip();

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

    // Ask MSport for the fixture by id rather than intersecting the two feeds.
    //
    // That premise is the whole reason conversion between these two is exact - both run the
    // hopegaming platform and carry the same Sportradar event ids - so asking by id is what the
    // converter does and what is worth testing. Intersecting the lists tested something else and
    // failed for an unrelated reason: MSport's feed returns the live window, so it never contains
    // the fixtures SportyBet lists for the next three days.
    const priced = sbFixtures.filter((f) => f.offers.some((o) => o.raw.marketId === "1" && o.market));
    let shared: (typeof priced)[number] | undefined;
    for (const candidate of priced.slice(0, 10)) {
      const got = await getEventMarkets(candidate.event.externalId).catch(() => null);
      if (got && got.offers.length > 0) {
        shared = candidate;
        break;
      }
    }
    expect(shared, `MSport carried none of the first ${Math.min(priced.length, 10)} SportyBet fixtures by id`).toBeDefined();

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
