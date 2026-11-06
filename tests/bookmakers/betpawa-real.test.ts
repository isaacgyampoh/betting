import { describe, expect, it } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { loadCode } from "@/lib/bookmakers/live/betpawa";

/**
 * betPawa, against the real site.
 *
 *   BETPAWA_TEST_CODE=<code> pnpm vitest run tests/bookmakers/betpawa-real.test.ts
 *
 * Reading a booking code needs no account and writes nothing: a code is a shareable list of picks
 * and this only opens one. Built on 2026-11-06 against QG9EAJ3, which returned two Serie A and
 * LaLiga picks with prices.
 *
 * The capture notes recorded this endpoint as protobuf, which is why betPawa was never built. It
 * answers JSON now, with every field named. If it ever returns to protobuf this test is where it
 * will show up first.
 */
const code = process.env.BETPAWA_TEST_CODE;

describe.skipIf(!code)("betPawa booking codes", () => {
  it("opens a real code and reads the games off it", async () => {
    const slip = await loadCode(code!);

    expect(slip.bookmaker).toBe("betpawa");
    expect(slip.selections.length).toBeGreaterThan(0);

    for (const [i, s] of slip.selections.entries()) {
      expect(s.event.home, `pick ${i + 1} home`).toBeTruthy();
      expect(s.event.away, `pick ${i + 1} away`).toBeTruthy();
      expect(s.event.kickoffAt.getTime(), `pick ${i + 1} kickoff`).toBeGreaterThan(0);
      expect(s.raw.marketId, `pick ${i + 1} market`).toBeTruthy();
    }

    // A code whose every price is missing is a payload we have misread, not a quiet slip.
    expect(slip.selections.some((s) => s.odds !== null && s.odds > 1)).toBe(true);

    for (const s of slip.selections) {
      const m = s.market ? `${s.market.type}/${s.market.outcome}` : "unmapped";
      console.log(`  ${s.event.home} v ${s.event.away} — ${s.raw.marketId} → ${m} @ ${s.odds}`);
    }
  }, 60_000);

  it("rejects a code that does not exist", async () => {
    await expect(loadCode("ZZZZZZZ")).rejects.toThrow(/doesn't recognise/);
  }, 60_000);
});

describe("betPawa is connected for reading, not for booking", () => {
  it("declares exactly what it can do", () => {
    const adapter = createAdapter("betpawa", "live");
    expect(adapter.capabilities).toEqual({ loadCode: true, createCode: false, events: false });
  });
});

/**
 * The thing betPawa was built for: a slip leaving it.
 *
 * Reading a code is only half of a conversion - the picks have to be findable and priceable
 * somewhere a user can actually book. Verified on 2026-11-06 with QANPYA1: four 1X2 picks, all
 * four found on SportyBet, betPawa the better price on three of them.
 *
 *   BETPAWA_TEST_CODE=<code> SPORTYBET_MODE=live pnpm vitest run tests/bookmakers/betpawa-real.test.ts
 */
describe.skipIf(!code)("converting a betPawa slip to a bookmaker we can book at", () => {
  it("finds each mapped pick on SportyBet and reports both prices", async () => {
    const sporty = await import("@/lib/bookmakers/live/sportybet");
    const slip = await loadCode(code!);

    const mapped = slip.selections.filter((s) => s.market);
    // A code of nothing but 1UP promos has nothing to convert, and that is a real answer - but
    // then this test has nothing to say either.
    if (!mapped.length) return;

    let converted = 0;
    for (const s of mapped) {
      const found = await sporty.searchEvent(s.event.home, s.event.away, s.event.kickoffAt).catch(() => []);
      if (!found.length) continue;

      const { offers } = await sporty.getEventMarkets(found[0].externalId);
      const match = offers.find((o) => o.market && JSON.stringify(o.market) === JSON.stringify(s.market));
      if (!match) continue;

      expect(match.odds).toBeGreaterThan(1);
      console.log(`  ${s.event.home} v ${s.event.away}: betPawa ${s.odds} -> SportyBet ${match.odds}`);
      converted++;
    }

    expect(converted, "no mapped betPawa pick could be found and priced on SportyBet").toBeGreaterThan(0);
  }, 180_000);
});
