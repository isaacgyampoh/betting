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
