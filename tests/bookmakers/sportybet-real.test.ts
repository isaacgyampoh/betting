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

/**
 * A code of the right shape that no bookmaker can have issued.
 *
 * This was `ZZZ999`, which turned out to be a code somebody had really created: it loads a
 * Lincoln City v West Ham slip from 14 October, so the adapter resolved it and the test read that
 * as a bug in our invalid-code handling. It was not - a genuinely unknown code (`AAAAAA`) was
 * rejected correctly the whole time.
 *
 * Ten characters is the longest the format allows, which is what makes this safe rather than
 * merely unlikely: 36^10 is about 3.7e15 combinations, against the far smaller number of codes a
 * bookmaker has ever issued. A short fixed string is a collision waiting to happen.
 */
function unissuableCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

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
    await expect(adapter.loadCode(unissuableCode())).rejects.toMatchObject({ code: "INVALID_CODE" });
  }, 30_000);

  // The full loop: book a real code at SportyBet, then read it back and check we get the same picks
  // with prices. This is what proves convert, trim and split actually work.
  it("books a code and reads back the same picks", async () => {
    const mapped = offers.filter((o) => o.market);
    const main = mapped.find((o) => o.raw.marketId === "1");
    const total = mapped.find((o) => o.raw.marketId === "18"); // carries a specifier
    expect(main, "needs a 1X2 offer").toBeDefined();
    expect(total, "needs an over/under offer").toBeDefined();

    const created = await adapter.createCode([
      { eventExternalId: target.externalId, market: main!.market! },
      { eventExternalId: target.externalId, market: total!.market! },
    ]);
    expect(created.code).toMatch(/^[A-Z0-9]{5,10}$/);
    expect(created.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    console.log(`\n  booked ${created.code} (expires ${created.expiresAt?.toISOString()})`);

    const slip = await adapter.loadCode(created.code);
    expect(slip.code).toBe(created.code);
    expect(slip.selections).toHaveLength(2);
    for (const sel of slip.selections) {
      expect(sel.event.externalId).toBe(target.externalId);
      expect(sel.odds).toBeGreaterThan(1);
      expect(sel.market).not.toBeNull();
    }
    // The line on the over/under pick must survive the round trip, or we would book a different bet.
    const back = slip.selections.find((sel) => sel.raw.marketId === "18");
    expect(back!.raw.specifier).toBe(total!.raw.specifier);
    expect(back!.market).toEqual(total!.market);
  }, 90_000);

  it("refuses to book a market SportyBet does not offer", async () => {
    await expect(
      adapter.createCode([{ eventExternalId: target.externalId, market: { type: "CORRECT_SCORE", period: "FT", outcome: "2:1", line: null } }]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 30_000);
});
