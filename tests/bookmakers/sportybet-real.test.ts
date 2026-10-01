import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { getEventOffersWithProbability, listUpcoming } from "@/lib/bookmakers/live/sportybet";
import type { BookmakerEventInfo } from "@/lib/bookmakers/types";

// Checks the live SportyBet adapter against the real API. Skipped by default because it needs the
// network and real fixtures exist only during the season; run it with:
//
//   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/sportybet-real.test.ts
//
// Run it after touching the live client or the Betradar market map — it is what tells us whether
// SportyBet has changed its response shape under us. There is no database here, which also proves
// the adapter works with the cache unavailable.

const live = process.env.VERIFY_LIVE === "1";
const adapter = createAdapter("sportybet", "live");

describe.skipIf(!live)("SportyBet live API", () => {
  let fixtures: BookmakerEventInfo[] = [];
  let target: BookmakerEventInfo;
  let offers: Awaited<ReturnType<typeof getEventOffersWithProbability>>["offers"] = [];
  let event: BookmakerEventInfo;

  beforeAll(async () => {
    fixtures = await listUpcoming({ hours: 48, pages: 2 });
    // Prefer a Sportradar-sourced fixture: the low-tier BetGenius feed carries far fewer markets.
    target = fixtures.find((f) => !f.externalId.includes("1111111")) ?? fixtures[0];
    const res = await getEventOffersWithProbability(target.externalId);
    offers = res.offers;
    event = res.event;
  }, 60_000);

  afterAll(() => {
    if (fixtures.length) console.log(`\n  checked ${event?.home} v ${event?.away} — ${offers.length} offers`);
  });

  it("lists real upcoming fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(10);
    for (const f of fixtures) {
      expect(f.home).toBeTruthy();
      expect(f.away).toBeTruthy();
      expect(f.externalId).toMatch(/^sr:match:\d+$/);
      // Allow an hour of slack for a fixture that has just kicked off.
      expect(f.kickoffAt.getTime()).toBeGreaterThan(Date.now() - 3_600_000);
    }
  });

  it("returns priced offers for an event", () => {
    expect(offers.length).toBeGreaterThan(5);
    expect(offers.every((o) => o.odds > 1)).toBe(true);
  });

  it("maps a useful share of the real market list", () => {
    const mapped = offers.filter((o) => o.market);
    expect(mapped.length).toBeGreaterThanOrEqual(10);
    const types = new Set(mapped.map((o) => o.market!.type));
    // The markets Ghanaian slips actually use must all be understood.
    expect(types).toContain("MATCH_RESULT");
    expect(types).toContain("OVER_UNDER");
    expect(types).toContain("DOUBLE_CHANCE");
    expect(types).toContain("BTTS");
  });

  it("round-trips every mapped offer back to the same SportyBet ids", () => {
    const teams = { home: event.home, away: event.away };
    for (const o of offers.filter((x) => x.market)) {
      const back = adapter.unmapMarket(o.market!, teams);
      expect(back, JSON.stringify(o.market)).not.toBeNull();
      expect({ m: back!.marketId, o: back!.outcomeId, s: back!.specifier }).toEqual({
        m: o.raw.marketId,
        o: o.raw.outcomeId,
        s: o.raw.specifier,
      });
    }
  });

  it("carries SportyBet's own probability on every offer", () => {
    expect(offers.every((o) => o.probability !== null)).toBe(true);
    const main = offers.filter((o) => o.raw.marketId === "1");
    expect(main).toHaveLength(3);
    // Probabilities are margin-free (they sum to 1); the prices carry the margin.
    expect(main.reduce((a, o) => a + o.probability!, 0)).toBeCloseTo(1, 2);
    const margin = main.reduce((a, o) => a + 1 / o.odds, 0) - 1;
    expect(margin).toBeGreaterThan(0);
    expect(margin).toBeLessThan(0.2);
  });

  it("finds a known fixture and not an invented one", async () => {
    const found = await adapter.searchEvent(target.home, target.away, target.kickoffAt);
    expect(found.map((e) => e.externalId)).toContain(target.externalId);
    expect(await adapter.searchEvent("Nonexistent Rovers", "Imaginary City", target.kickoffAt)).toEqual([]);
  }, 60_000);

  it("reports an unknown booking code as invalid", async () => {
    await expect(adapter.loadCode("ZZZ999")).rejects.toMatchObject({ code: "INVALID_CODE" });
  }, 30_000);
});
