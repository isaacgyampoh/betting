import { describe, expect, it } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { listUpcomingWithOffers, getEventMarkets } from "@/lib/bookmakers/live/1xbet";
import * as paripesa from "@/lib/bookmakers/live/paripesa";
import * as twentytwo from "@/lib/bookmakers/live/22bet";

// Fixtures and odds on the 1xBet platform, against the real feeds. Booking is deliberately not
// covered here: it is unverified and the adapters declare it unsupported.
//   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/onex-real.test.ts

const live = process.env.VERIFY_LIVE === "1";

describe.skipIf(!live)("1xBet platform: fixtures and odds", () => {
  it("lists real fixtures with priced, mapped markets", async () => {
    const fixtures = await listUpcomingWithOffers({ count: 60 });
    expect(fixtures.length).toBeGreaterThan(10);

    for (const f of fixtures) {
      expect(f.event.home).toBeTruthy();
      expect(f.event.away).toBeTruthy();
      expect(f.event.kickoffAt.getTime()).toBeGreaterThan(0);
    }

    const mapped = fixtures.flatMap((f) => f.offers).filter((o) => o.market);
    expect(mapped.length).toBeGreaterThan(20);
    const types = new Set(mapped.map((o) => o.market!.type));
    expect(types).toContain("MATCH_RESULT");
    console.log(`\n  ${fixtures.length} fixtures, ${mapped.length} mapped offers, types: ${[...types].join(", ")}`);
  }, 90_000);

  it("round-trips every mapped offer to the same ids", async () => {
    const adapter = createAdapter("1xbet", "live");
    const fixtures = await listUpcomingWithOffers({ count: 40 });
    const teams = { home: "A", away: "B" };
    for (const o of fixtures.flatMap((f) => f.offers).filter((x) => x.market)) {
      const back = adapter.unmapMarket(o.market!, teams);
      expect(back, JSON.stringify(o.market)).not.toBeNull();
      expect({ marketId: back!.marketId, outcomeId: back!.outcomeId, specifier: back!.specifier }).toEqual({
        marketId: o.raw.marketId,
        outcomeId: o.raw.outcomeId,
        specifier: o.raw.specifier,
      });
    }
  }, 90_000);

  it("reads one event's full market list", async () => {
    const fixtures = await listUpcomingWithOffers({ count: 40 });
    const target = fixtures.find((f) => f.event.status === "NOT_STARTED") ?? fixtures[0];
    const { event, offers } = await getEventMarkets(target.event.externalId);
    expect(event.home).toBeTruthy();
    // A single fixture carries hundreds of markets; most stay unmapped on purpose.
    expect(offers.length).toBeGreaterThan(50);
    expect(offers.filter((o) => o.market).length).toBeGreaterThan(10);
  }, 90_000);

  it("works the same on PariPesa and 22Bet, which share the platform", async () => {
    for (const [name, mod] of [
      ["PariPesa", paripesa],
      ["22Bet", twentytwo],
    ] as const) {
      const fixtures = await mod.listUpcomingWithOffers({ count: 30 });
      expect(fixtures.length, name).toBeGreaterThan(5);
      const mapped = fixtures.flatMap((f) => f.offers).filter((o) => o.market);
      expect(mapped.length, name).toBeGreaterThan(10);
      console.log(`  ${name}: ${fixtures.length} fixtures, ${mapped.length} mapped offers`);
    }
  }, 120_000);

  it("declares booking unsupported until it has been verified", () => {
    for (const slug of ["1xbet", "paripesa", "22bet", "betwinner"] as const) {
      const a = createAdapter(slug, "live");
      expect(a.capabilities, slug).toEqual({ loadCode: false, createCode: false, events: true });
    }
  });
});
