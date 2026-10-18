import { beforeAll, describe, expect, it } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { getEventMarkets, listUpcoming } from "@/lib/bookmakers/live/footballcom";
import type { BookmakerEventInfo } from "@/lib/bookmakers/types";

// Football.com runs the same platform as SportyBet, so this checks the shared client really does
// work against a second operator rather than only the one it was written for. Run with:
//   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/footballcom-real.test.ts

const live = process.env.VERIFY_LIVE === "1";
const adapter = createAdapter("footballcom", "live");

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

describe.skipIf(!live)("Football.com live API", () => {
  let fixtures: BookmakerEventInfo[] = [];
  let target!: BookmakerEventInfo;
  let offers: Awaited<ReturnType<typeof getEventMarkets>>["offers"] = [];

  beforeAll(async () => {
    fixtures = await listUpcoming({ hours: 72, pages: 2 });
    // An hour out at least, and with a real market list: a bookmaker refuses a game about to start,
    // and plenty of obscure fixtures carry only a handful of prices.
    const soonest = Date.now() + 60 * 60_000;
    for (const f of fixtures.filter((x) => x.status === "NOT_STARTED" && x.kickoffAt.getTime() > soonest).slice(0, 8)) {
      const got = (await getEventMarkets(f.externalId)).offers;
      const has = (id: string) => got.some((o) => o.raw.marketId === id && o.market);
      if (got.length > 10 && has("1") && has("18")) {
        target = f;
        offers = got;
        break;
      }
    }
    if (!target) throw new Error("No Football.com fixture with a full market list");
  }, 120_000);

  it("lists real upcoming fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(10);
    for (const f of fixtures) expect(f.externalId).toMatch(/^sr:match:\d+$/);
  });

  it("maps the markets Ghanaian slips use, and carries a probability", () => {
    expect(offers.length).toBeGreaterThan(10);
    expect(offers.every((o) => o.odds > 1)).toBe(true);
    const types = new Set(offers.filter((o) => o.market).map((o) => o.market!.type));
    expect(types).toContain("MATCH_RESULT");
    expect(types).toContain("OVER_UNDER");
  });

  it("round-trips every mapped offer to the same ids", () => {
    const teams = { home: target.home, away: target.away };
    for (const o of offers.filter((x) => x.market)) {
      const back = adapter.unmapMarket(o.market!, teams);
      expect({ m: back?.marketId, o: back?.outcomeId, s: back?.specifier }).toEqual({
        m: o.raw.marketId,
        o: o.raw.outcomeId,
        s: o.raw.specifier,
      });
    }
  });

  it("books a code and reads back the same picks", async () => {
    const main = offers.find((o) => o.raw.marketId === "1" && o.market);
    const total = offers.find((o) => o.raw.marketId === "18" && o.market);
    const created = await adapter.createCode([
      { eventExternalId: target.externalId, raw: main!.raw },
      { eventExternalId: target.externalId, raw: total!.raw },
    ]);
    expect(created.code).toMatch(/^[A-Z0-9]{5,10}$/);
    console.log(`\n  Football.com booked ${created.code} for ${target.home} v ${target.away}`);

    const slip = await adapter.loadCode(created.code);
    expect(slip.selections).toHaveLength(2);
    expect(slip.selections.every((s) => (s.odds ?? 0) > 1)).toBe(true);
    // The line must survive, or we book a different bet.
    expect(slip.selections.find((s) => s.raw.marketId === "18")!.raw.specifier).toBe(total!.raw.specifier);
  }, 90_000);

  it("reports an unknown code as invalid", async () => {
    await expect(adapter.loadCode(unissuableCode())).rejects.toMatchObject({ code: "INVALID_CODE" });
  }, 30_000);
});
