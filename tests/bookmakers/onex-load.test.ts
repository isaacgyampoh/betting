import { describe, expect, it } from "vitest";
import * as onexbet from "@/lib/bookmakers/live/1xbet";
import * as paripesa from "@/lib/bookmakers/live/paripesa";
import * as twentytwo from "@/lib/bookmakers/live/22bet";
import * as betwinner from "@/lib/bookmakers/live/betwinner";

/**
 * Can we *read* a booking code on the 1xBet platform?
 *
 * This is deliberately separate from `onex-real.test.ts`, which answers a different question and
 * conflates two operations. That test creates a code and then reads it back, so when SaveCoupon
 * failed on 2026-10-16 - 1xBet with ErrorCode 161627, PariPesa with a coupon that came back empty
 * - reading was never exercised against a code that had anything in it. Both adapters have been
 * declared `loadCode: false` ever since, on the strength of a *booking* failure.
 *
 * Reading matters on its own. Creating a code makes one of these bookmakers a destination, which
 * needs an agreement with the operator. Reading one makes it a *source* - someone who bets on
 * 1xBet can move their slip to a bookmaker we can book - and needs nothing but a working
 * endpoint.
 *
 * There is reason to think it works. `GetCoupon` is live and discriminating: a bogus code returns
 * `{"Success":false,"Error":"Incorrect code","ErrorCode":100849}`, which is exactly the shape
 * loadCode expects and turns into INVALID_CODE. What has never been checked is whether a real,
 * populated coupon comes back with its events in the shape the parser wants.
 *
 * One real code settles it. Build a slip on any of the four, tap Book, and run:
 *
 *   ONEX_TEST_CODE=<code> ONEX_TEST_SLUG=1xbet pnpm vitest run tests/bookmakers/onex-load.test.ts
 *
 * No account and no money: a booking code is a shareable list of picks, and this only reads it.
 * If it passes, set `loadCode: true` on that adapter and drop it from AWAITING_SETUP - the
 * conversion path is already written and tested against the other bookmakers.
 */
const code = process.env.ONEX_TEST_CODE;
const slug = process.env.ONEX_TEST_SLUG ?? "1xbet";

const CLIENTS = { "1xbet": onexbet, paripesa, "22bet": twentytwo, betwinner } as const;

describe.skipIf(!code)(`reading a real booking code on ${slug}`, () => {
  it("opens the code and returns the picks that are on it", async () => {
    const client = CLIENTS[slug as keyof typeof CLIENTS];
    expect(client, `unknown slug ${slug}; use one of ${Object.keys(CLIENTS).join(", ")}`).toBeTruthy();

    const slip = await client.loadCode(code!);

    // The thing that was never confirmed: a populated coupon parses into selections.
    expect(slip.selections.length).toBeGreaterThan(0);

    for (const [i, s] of slip.selections.entries()) {
      expect(s.event.home, `pick ${i + 1} home`).toBeTruthy();
      expect(s.event.away, `pick ${i + 1} away`).toBeTruthy();
      // An odds of null is allowed by the type; a code that reads back with no prices at all is
      // the empty-coupon failure wearing a different hat, so at least one must be priced.
      expect(s.raw.outcomeId, `pick ${i + 1} outcome`).toBeTruthy();
    }
    expect(slip.selections.some((s) => s.odds !== null && s.odds > 1)).toBe(true);

    console.log(`\n  read ${slip.selections.length} picks from ${slug} code ${code}`);
    for (const s of slip.selections) {
      const market = s.market ? `${s.market.type} ${s.market.outcome}${s.market.line === null ? "" : ` ${s.market.line}`}` : "unmapped";
      console.log(`    ${s.event.home} v ${s.event.away} — ${market} @ ${s.odds ?? "—"}`);
    }
    const mapped = slip.selections.filter((s) => s.market).length;
    console.log(`  ${mapped}/${slip.selections.length} mapped to our markets`);
    console.log(`  -> reading works: set loadCode: true on ${slug} and drop it from AWAITING_SETUP`);
  }, 60_000);

  it("still rejects a code that does not exist", async () => {
    const client = CLIENTS[slug as keyof typeof CLIENTS];
    await expect(client.loadCode("ZZZZZZ")).rejects.toThrow();
  }, 60_000);
});
