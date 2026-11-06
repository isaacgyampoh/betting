import { describe, expect, it } from "vitest";
import { createAdapter, getAdapter } from "@/lib/bookmakers/registry";
import { convertSelection } from "@/lib/services/convert";
import { buildAliasIndex } from "@/lib/matching/similarity";
import type { LoadedSelection } from "@/lib/bookmakers/types";
import type { SlipRecord } from "@/lib/services/slips";

/**
 * The conversion rates, re-measured against the real feeds.
 *
 * Two numbers are worth protecting because both were once zero and the reason was invisible:
 *
 *   SportyBet → MSport   20/20 fixtures carried.
 *   betPawa   → MSport    4/4  fixtures carried.
 *
 * The betPawa one is the interesting half. betPawa has its own fixture ids, so there is no shared id
 * to ask MSport for; and MSport's `all-matches/next-7-days` ignores `pageNum` and caps `pageSize` at
 * 50, so its own search only ever returns the fifty fixtures nearest kick-off. Both routes missed
 * and a real four-leg betPawa slip converted to nothing. The shared-id fallback - resolve the names
 * at a bookmaker that *can* search, then address MSport by the Sportradar id it returns - is what
 * makes it 4/4, and this is the test that would notice it breaking.
 *
 * Live, so it is gated. The deterministic half of this - every way a conversion is allowed to
 * refuse - is in tests/services/convert-accuracy.test.ts and runs on every commit.
 *
 *   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/conversion-rates.live.test.ts
 *
 * The betPawa leg needs a booking code that still resolves. Codes expire, so it reads one from
 * BETPAWA_TEST_CODE and skips - rather than failing - when the default has aged out. A skip here
 * means "no sample", not "conversion is broken"; the suite says which.
 */

const live = process.env.VERIFY_LIVE === "1";

/**
 * The resolvers have to be live, and that is not the default.
 *
 * The fallback asks the registry for its resolvers by slug - `getAdapter("sportybet")` - rather than
 * constructing them, because in production it must get whatever that bookmaker is actually
 * configured as. The registry defaults every bookmaker to its mock, so without this the fallback
 * resolves names against sample fixtures, finds nothing, and this file reports betPawa → MSport as
 * 0/5 with no indication that the feeds were never consulted. That is exactly what it did on first
 * run, and the conversion was fine.
 *
 * Set before the first getAdapter call, since the registry caches each adapter on first use.
 */
if (live) {
  for (const v of ["SPORTYBET_MODE", "FOOTBALLCOM_MODE", "MSPORT_MODE", "BETPAWA_MODE"]) {
    process.env[v] = "live";
  }
}

const aliases = buildAliasIndex();
const msport = createAdapter("msport", "live");

/** The default is the four-leg slip the 4/4 figure was first measured on. */
const BETPAWA_CODE = process.env.BETPAWA_TEST_CODE ?? "CFQUYS8";

/** A loaded selection in the shape a SlipRecord carries, which is what convertSelection takes. */
function asRecordSelection(s: LoadedSelection, position: number): SlipRecord["selections"][number] {
  return {
    position,
    homeTeam: s.event.home,
    awayTeam: s.event.away,
    kickoffAt: s.event.kickoffAt,
    competition: s.event.competition,
    marketType: s.market?.type ?? null,
    period: s.market?.period ?? "FT",
    outcome: s.market?.outcome ?? null,
    line: s.market?.line ?? null,
    raw: s.raw,
    bookmakerEvent: { externalId: s.event.externalId },
  } as unknown as SlipRecord["selections"][number];
}

/**
 * Carried means "MSport has this fixture". Priced is a stricter thing and not what is measured here:
 * two bookmakers on the same platform will not always have the same market open on the same game,
 * and a leg found but not priced is reported honestly as MARKET_NOT_FOUND.
 */
const CARRIED = new Set(["OK", "MARKET_NOT_FOUND"]);

/**
 * A leg whose own market we never modelled, refused before any bookmaker is contacted.
 *
 * It belongs in neither column. The first run of this file counted it as a miss and reported
 * betPawa → MSport as 4/5, which reads as a conversion failure and is not one: the fifth leg of
 * CFQUYS8 is betPawa's "1X2 and Totals - FT", one bet on the result and the total together, which
 * is in betpawa-format's NEVER_MAP because our Market model holds a single pick and mapping it to
 * either half would hand somebody an easier bet than the one they made. Refusing it is the correct
 * outcome and MSport is never asked about it.
 */
const NOT_APPLICABLE = "UNSUPPORTED_MARKET";

describe.skipIf(!live)("SportyBet to MSport", () => {
  it("carries every one of twenty fixtures", async (ctx) => {
    const { listUpcoming } = await import("@/lib/bookmakers/live/sportybet");
    const fixtures = await listUpcoming({ hours: 72, pages: 3 });
    const sample = fixtures.filter((f) => f.status === "NOT_STARTED").slice(0, 20);
    if (sample.length < 20) return ctx.skip();

    const now = new Date();
    const results = await Promise.all(
      sample.map((f, i) =>
        convertSelection(
          asRecordSelection(
            { event: f, raw: { marketId: "1", outcomeId: "1", specifier: "" }, market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null }, odds: null },
            i + 1,
          ),
          msport,
          aliases,
          now,
        ),
      ),
    );

    const carried = results.filter((r) => CARRIED.has(r.draft.status));
    const priced = results.filter((r) => r.draft.status === "OK");
    const missed = results
      .map((r, i) => ({ r, f: sample[i] }))
      .filter(({ r }) => !CARRIED.has(r.draft.status))
      .map(({ r, f }) => `${f.home} v ${f.away} (${f.externalId}): ${r.draft.status}`);

    console.log(`\n  SportyBet → MSport: ${carried.length}/${sample.length} fixtures carried, ${priced.length} priced`);
    if (missed.length) console.log(`    missed:\n      ${missed.join("\n      ")}`);

    expect(missed, `fixtures MSport did not carry:\n${missed.join("\n")}`).toEqual([]);
    expect(carried).toHaveLength(20);
  }, 180_000);
});

describe.skipIf(!live)("betPawa to MSport", () => {
  it("carries every fixture of a real betPawa slip, by resolving its shared id", async (ctx) => {
    const betpawa = createAdapter("betpawa", "live");
    const slip = await betpawa.loadCode(BETPAWA_CODE).catch(() => null);
    if (!slip || slip.selections.length === 0) {
      console.log(`\n  betPawa code ${BETPAWA_CODE} no longer resolves - set BETPAWA_TEST_CODE to a current one.`);
      return ctx.skip();
    }

    // A mock resolver would make every assertion below meaningless, so it is checked, not assumed.
    expect(getAdapter("sportybet").mode, "resolver is not live - see the env block above").toBe("live");

    // betPawa's own ids, which MSport has never heard of. That is the premise of the fallback.
    expect(slip.selections.every((s) => !s.event.externalId.startsWith("sr:match:"))).toBe(true);

    const now = new Date();
    const upcoming = slip.selections.filter((s) => s.event.kickoffAt > now);
    if (upcoming.length === 0) return ctx.skip();

    const results = await Promise.all(
      upcoming.map((s, i) => convertSelection(asRecordSelection(s, i + 1), msport, aliases, now)),
    );

    const rows = results.map((r, i) => ({ r, s: upcoming[i] }));
    const convertible = rows.filter(({ r }) => r.draft.status !== NOT_APPLICABLE);
    const refusedAtSource = rows.filter(({ r }) => r.draft.status === NOT_APPLICABLE);
    const carried = convertible.filter(({ r }) => CARRIED.has(r.draft.status));
    const missed = convertible
      .filter(({ r }) => !CARRIED.has(r.draft.status))
      .map(({ r, s }) => `${s.event.home} v ${s.event.away}: ${r.draft.status}`);

    console.log(
      `\n  betPawa ${BETPAWA_CODE} → MSport: ${carried.length}/${convertible.length} fixtures carried` +
        `, ${results.filter((r) => r.draft.status === "OK").length} priced` +
        (refusedAtSource.length
          ? `\n    refused at the source (market we do not model): ${refusedAtSource
              .map(({ s }) => `${s.event.home} v ${s.event.away}`)
              .join(", ")}`
          : ""),
    );
    if (missed.length) console.log(`    missed:\n      ${missed.join("\n      ")}`);

    expect(convertible.length, "no convertible leg left in this code - set BETPAWA_TEST_CODE").toBeGreaterThan(0);
    // Every carried fixture must have come through the fallback with a real MSport id.
    for (const { r } of carried) expect(r.link?.targetExternalId).toMatch(/^sr:match:\d+$/);
    expect(missed, `fixtures MSport did not carry:\n${missed.join("\n")}`).toEqual([]);
  }, 180_000);
});
