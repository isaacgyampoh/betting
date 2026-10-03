import { describe, expect, it } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { listUpcomingWithOffers, getEventMarkets, createCode, loadCode } from "@/lib/bookmakers/live/1xbet";
import * as paripesa from "@/lib/bookmakers/live/paripesa";
import * as twentytwo from "@/lib/bookmakers/live/22bet";

// Fixtures and odds on the 1xBet platform, against the real feeds.
//   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/onex-real.test.ts
//
// Booking is the one thing left and is behind its own flag, because it is the only check here that
// writes anything at the bookmaker - it creates a real booking code (no account, no money; a code
// is a shareable list of picks) and reads it back:
//   VERIFY_BOOKING=1 pnpm vitest run tests/bookmakers/onex-real.test.ts
// If that passes, flip the four adapters to loadCode/createCode true; nothing else needs writing.

const live = process.env.VERIFY_LIVE === "1";
const booking = process.env.VERIFY_BOOKING === "1";

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

// The one check left on this platform. It books a real code from a real upcoming fixture and reads
// it back, which is the only way to know the SaveCoupon body is right: the endpoint returns a code
// even when it accepted nothing, so a code coming back proves nothing on its own.
describe.skipIf(!booking)("1xBet platform: booking a code", () => {
  it("books two picks and reads them back", async () => {
    const fixtures = await listUpcomingWithOffers({ count: 60 });
    const usable = fixtures
      .map((f) => ({ event: f.event, offer: f.offers.find((o) => o.market?.type === "MATCH_RESULT" && o.odds && o.odds > 1) }))
      .filter((f): f is { event: typeof f.event; offer: NonNullable<typeof f.offer> } => Boolean(f.offer))
      .slice(0, 2);

    expect(usable.length, "need two upcoming fixtures with a priced 1X2 market").toBe(2);

    const created = await createCode(
      usable.map(({ event, offer }) => ({
        eventExternalId: event.externalId,
        market: offer.market!,
        raw: offer.raw,
      })),
    );
    console.log(`\n  booked ${created.code}`);

    const read = await loadCode(created.code);
    expect(read.selections).toHaveLength(usable.length);
    for (const [i, selection] of read.selections.entries()) {
      expect(selection.event.home, `pick ${i + 1}`).toBe(usable[i].event.home);
      expect(selection.event.away, `pick ${i + 1}`).toBe(usable[i].event.away);
      expect(selection.raw.outcomeId, `pick ${i + 1}`).toBe(usable[i].offer.raw.outcomeId);
    }
    console.log(`  read back ${read.selections.length} picks, same games and same outcomes`);
    console.log("  -> booking works: set loadCode/createCode to true in the four onex adapters");
  }, 120_000);
});
