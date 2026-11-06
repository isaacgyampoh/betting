import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookmakerAdapter,
  BookmakerEventInfo,
  BookmakerSlug,
  EventMarkets,
  RawMarket,
} from "@/lib/bookmakers/types";
import type { Market } from "@/lib/markets/types";
import { buildAliasIndex } from "@/lib/matching/similarity";
import { totalOdds } from "@/lib/slips/view";
import type { SlipRecord } from "@/lib/services/slips";

/**
 * What a conversion is allowed to get wrong.
 *
 * Every other failure in this product is visible. A fixture that cannot be found says so, a market
 * that is not offered says so, a bookmaker that refuses us says so. Converting to the *wrong*
 * fixture is the one failure that reaches the user looking exactly like a success: a leg with two
 * team names, a market and a price, all of it plausible, none of it the bet they asked for. They
 * find out when it settles.
 *
 * So the rules below are not about the happy path - that is measured live, against the real feeds,
 * in conversion-rates.live.test.ts. These are the refusals: the cases where the honest answer is
 * "we could not carry this leg", and where an earlier version of this code would instead have
 * priced something.
 *
 * Everything here is deterministic. Fake adapters, no network, so the guard runs on every commit
 * rather than only when somebody remembers to set VERIFY_LIVE.
 */

// Hoisted so the module mock below can see it: tests register which adapter each resolver slug
// returns, because the shared-id fallback asks the registry for them by name.
const h = vi.hoisted(() => ({ resolvers: new Map<string, unknown>() }));

vi.mock("@/lib/bookmakers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bookmakers/registry")>();
  return {
    ...actual,
    getAdapter: (slug: BookmakerSlug) => h.resolvers.get(slug) ?? actual.getAdapter(slug),
  };
});

const { convertSelection } = await import("@/lib/services/convert");

const aliases = buildAliasIndex();
const KICKOFF = new Date("2026-12-01T19:00:00.000Z");
const NOW = new Date("2026-12-01T12:00:00.000Z");
const minutes = (n: number) => new Date(KICKOFF.getTime() + n * 60_000);

const HOME_WIN: Market = { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null };
const RAW: RawMarket = { marketId: "1", outcomeId: "1", specifier: "", marketName: "1X2", outcomeName: "Home" };

function event(over: Partial<BookmakerEventInfo> = {}): BookmakerEventInfo {
  return {
    externalId: "sr:match:100",
    home: "Arsenal",
    away: "Chelsea",
    kickoffAt: KICKOFF,
    competition: "Premier League",
    country: "England",
    status: "NOT_STARTED",
    ...over,
  };
}

/** A source selection shaped the way a SlipRecord carries one. */
function selection(
  over: Partial<{
    position: number;
    home: string;
    away: string;
    kickoffAt: Date;
    competition: string | null;
    marketType: string | null;
    outcome: string | null;
    line: number | null;
    externalId: string | null;
  }> = {},
) {
  return {
    position: over.position ?? 1,
    homeTeam: over.home ?? "Arsenal",
    awayTeam: over.away ?? "Chelsea",
    kickoffAt: over.kickoffAt ?? KICKOFF,
    competition: over.competition === undefined ? "Premier League" : over.competition,
    marketType: over.marketType === undefined ? "MATCH_RESULT" : over.marketType,
    period: "FT",
    outcome: over.outcome === undefined ? "HOME" : over.outcome,
    line: over.line ?? null,
    raw: null,
    // betPawa and the other own-id bookmakers carry an id that means nothing elsewhere, so the
    // default here is "no shared id" - which is the case the fallback exists for.
    bookmakerEvent: over.externalId === undefined ? null : { externalId: over.externalId },
  } as unknown as SlipRecord["selections"][number];
}

type FakeOpts = {
  slug?: BookmakerSlug;
  /** What the bookmaker's own fixture search returns. Default: nothing, like MSport past its window. */
  search?: BookmakerEventInfo[];
  /** Fixtures it will serve when asked by id, with their offers. */
  byId?: Record<string, { event: BookmakerEventInfo; offers: EventMarkets["offers"] }>;
};

/** Records every call, so a test can assert that booking was never one of them. */
function fake(opts: FakeOpts = {}) {
  const calls: string[] = [];
  const byId = opts.byId ?? {};
  const adapter = {
    slug: opts.slug ?? "msport",
    name: "Fake",
    mode: "live",
    capabilities: { loadCode: true, createCode: true, events: true },
    codeFormat: /^[A-Z0-9]{6}$/,
    normalizeCode: (c: string) => c.toUpperCase(),
    loadCode: async () => {
      calls.push("loadCode");
      throw new Error("not used");
    },
    createCode: async () => {
      calls.push("createCode");
      throw new Error("a draft conversion must never book");
    },
    searchEvent: async () => {
      calls.push("searchEvent");
      return opts.search ?? [];
    },
    getEventMarkets: async (id: string) => {
      calls.push(`getEventMarkets:${id}`);
      const hit = byId[id];
      if (!hit) throw new Error(`unknown event ${id}`);
      return { event: hit.event, offers: hit.offers };
    },
    mapMarket: () => null,
    unmapMarket: () => RAW,
  } as unknown as BookmakerAdapter;
  return { adapter, calls };
}

const offer = (odds: number, market: Market | null = HOME_WIN) => ({ raw: RAW, market, odds });

/** A resolver that finds the fixture by name and knows its Sportradar id. */
function resolverFinding(found: BookmakerEventInfo[]) {
  return fake({ slug: "sportybet", search: found }).adapter;
}

beforeEach(() => {
  h.resolvers.clear();
  // Both resolvers blind by default, so a test only exercises the fallback when it says to. Without
  // this the registry hands back the real mock adapters and they answer with their own fixtures.
  h.resolvers.set("sportybet", fake({ slug: "sportybet" }).adapter);
  h.resolvers.set("footballcom", fake({ slug: "footballcom" }).adapter);
});

describe("the shared-id fallback", () => {
  // The bug this exists for: betPawa carries its own fixture ids, so there is nothing to ask MSport
  // by - and MSport's own search cannot see past its live window, so the name route found nothing
  // either. Four legs of a real betPawa slip converted to zero. A resolver that *can* search bridges
  // the two: it turns names into the Sportradar id, and MSport answers to that.
  it("converts a leg the destination's own search cannot find", async () => {
    h.resolvers.set("sportybet", resolverFinding([event({ externalId: "sr:match:555" })]));
    const dest = fake({ byId: { "sr:match:555": { event: event({ externalId: "sr:match:555" }), offers: [offer(1.95)] } } });

    const { draft, link } = await convertSelection(selection(), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("OK");
    expect(draft.odds).toBe(1.95);
    expect(draft.event.externalId).toBe("sr:match:555");
    expect(link?.targetExternalId).toBe("sr:match:555");
    // The destination was still asked first; the fallback is not a shortcut around it.
    expect(dest.calls).toContain("searchEvent");
  });

  it("is not tried for a destination outside the shared id space", async () => {
    const resolver = fake({ slug: "sportybet", search: [event({ externalId: "sr:match:555" })] });
    h.resolvers.set("sportybet", resolver.adapter);
    const dest = fake({ slug: "betway", byId: { "sr:match:555": { event: event(), offers: [offer(1.95)] } } });

    const { draft } = await convertSelection(selection(), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("EVENT_NOT_FOUND");
    // Never consulted: its ids would mean nothing at a bookmaker with its own id space.
    expect(resolver.calls).not.toContain("searchEvent");
  });

  it("ignores a resolver that answers with an id from a different space", async () => {
    h.resolvers.set("sportybet", resolverFinding([event({ externalId: "betpawa-77" })]));
    const dest = fake({ byId: { "betpawa-77": { event: event(), offers: [offer(1.95)] } } });

    const { draft } = await convertSelection(selection(), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("EVENT_NOT_FOUND");
    expect(dest.calls).not.toContain("getEventMarkets:betpawa-77");
  });
});

describe("a destination that answers with the wrong fixture", () => {
  // Both id routes rest on one premise: sr:match:N is the same game everywhere on the platform.
  // Nothing checked it. If it ever stops being true the result is not an error, it is a priced leg
  // for a different match - so each route now compares what came back against what was asked for.
  it("refuses a fixture returned under the right id at the wrong time", async () => {
    const dest = fake({
      byId: {
        "sr:match:100": {
          event: event({ kickoffAt: minutes(180), home: "Everton", away: "Fulham" }),
          offers: [offer(2.4)],
        },
      },
    });

    const { draft } = await convertSelection(selection({ externalId: "sr:match:100" }), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("EVENT_NOT_FOUND");
    expect(draft.odds).toBeNull();
    // The source's own names survive on the unconverted leg, so the user sees what they asked for.
    expect(draft.event.home).toBe("Arsenal");
  });

  it("refuses a fixture whose teams are both somebody else", async () => {
    const dest = fake({
      byId: { "sr:match:100": { event: event({ home: "Everton", away: "Fulham" }), offers: [offer(2.4)] } },
    });

    const { draft } = await convertSelection(selection({ externalId: "sr:match:100" }), dest.adapter, aliases, NOW);
    expect(draft.status).toBe("EVENT_NOT_FOUND");
  });

  it("refuses a fixture from a different competition", async () => {
    const dest = fake({
      byId: {
        "sr:match:100": { event: event({ competition: "Club Friendlies" }), offers: [offer(2.4)] },
      },
    });

    const { draft } = await convertSelection(selection({ externalId: "sr:match:100" }), dest.adapter, aliases, NOW);
    expect(draft.status).toBe("EVENT_NOT_FOUND");
  });

  // The counter-example that set the bar. Measured 2026-11-06 on the same Sportradar id: SportyBet
  // lists "RC Deportivo de A Coruna", MSport lists "La Coruna". They score 0.38 against a 0.8
  // matching threshold, and they are the same club. A check that demanded both sides agree would
  // throw away a correct conversion, so the id is trusted where one side still reads true.
  it("accepts a fixture where one side is spelt unrecognisably differently", async () => {
    const dest = fake({
      byId: {
        "sr:match:100": {
          event: event({ home: "Espanyol", away: "La Coruna", competition: "LaLiga" }),
          offers: [offer(1.72)],
        },
      },
    });
    const sel = selection({ home: "Espanyol", away: "RC Deportivo de A Coruna", competition: "LaLiga", externalId: "sr:match:100" });

    const { draft } = await convertSelection(sel, dest.adapter, aliases, NOW);

    expect(draft.status).toBe("OK");
    expect(draft.odds).toBe(1.72);
  });

  it("falls through to the name search rather than failing outright", async () => {
    // A conflicting id is a reason to stop trusting the id, not a reason to give up on the leg.
    const dest = fake({
      search: [event({ externalId: "sr:match:900" })],
      byId: {
        "sr:match:100": { event: event({ home: "Everton", away: "Fulham" }), offers: [offer(2.4)] },
        "sr:match:900": { event: event({ externalId: "sr:match:900" }), offers: [offer(1.88)] },
      },
    });

    const { draft } = await convertSelection(selection({ externalId: "sr:match:100" }), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("OK");
    expect(draft.odds).toBe(1.88);
    expect(draft.event.externalId).toBe("sr:match:900");
  });
});

describe("two fixtures that fit equally well", () => {
  // Same teams, listed twice 28 minutes apart. Both are inside the ±15 minute tolerance of the
  // source, both score 1.00, and they are not each other - so there is no basis for choosing, and
  // the previous code chose whichever the feed listed first.
  const twins = () => [
    event({ externalId: "sr:match:201", kickoffAt: minutes(-14) }),
    event({ externalId: "sr:match:202", kickoffAt: minutes(14) }),
  ];

  it("refuses to pick one when the destination lists both", async () => {
    const dest = fake({
      search: twins(),
      byId: {
        "sr:match:201": { event: twins()[0], offers: [offer(1.9)] },
        "sr:match:202": { event: twins()[1], offers: [offer(2.6)] },
      },
    });

    const { draft } = await convertSelection(selection(), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("EVENT_NOT_FOUND");
    expect(draft.odds).toBeNull();
  });

  it("refuses to pick one when a resolver lists both", async () => {
    h.resolvers.set("sportybet", resolverFinding(twins()));
    const dest = fake({
      byId: {
        "sr:match:201": { event: twins()[0], offers: [offer(1.9)] },
        "sr:match:202": { event: twins()[1], offers: [offer(2.6)] },
      },
    });

    const { draft } = await convertSelection(selection(), dest.adapter, aliases, NOW);
    expect(draft.status).toBe("EVENT_NOT_FOUND");
  });

  it("still converts when the duplicate is the same fixture listed twice", async () => {
    // Feeds do emit a fixture twice under two ids. That is not ambiguity, and refusing it would
    // make an everyday feed quirk into an unconvertible leg.
    const dupes = [event({ externalId: "sr:match:301" }), event({ externalId: "sr:match:302" })];
    const dest = fake({
      search: dupes,
      byId: {
        "sr:match:301": { event: dupes[0], offers: [offer(1.9)] },
        "sr:match:302": { event: dupes[1], offers: [offer(1.9)] },
      },
    });

    const { draft } = await convertSelection(selection(), dest.adapter, aliases, NOW);
    expect(draft.status).toBe("OK");
  });
});

describe("markets and lines the destination does not offer", () => {
  it("reports a market the source itself never modelled, without asking the bookmaker", async () => {
    const dest = fake({ search: [event()] });
    const { draft, link } = await convertSelection(selection({ marketType: null, outcome: null }), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("UNSUPPORTED_MARKET");
    expect(draft.odds).toBeNull();
    // Nothing was spent finding a fixture for a bet we cannot describe.
    expect(dest.calls).toEqual([]);
    expect(link).toBeUndefined();
  });

  it("reports a market the destination does not price, keeping the fixture it did find", async () => {
    const dest = fake({
      search: [event()],
      byId: { "sr:match:100": { event: event(), offers: [offer(1.9, { type: "BTTS", period: "FT", outcome: "YES", line: null })] } },
    });

    const { draft, link } = await convertSelection(selection(), dest.adapter, aliases, NOW);

    expect(draft.status).toBe("MARKET_NOT_FOUND");
    expect(draft.odds).toBeNull();
    // The fixture was found, so the link is still worth recording for the alias index.
    expect(link?.targetExternalId).toBe("sr:match:100");
  });

  it("will not substitute a different line for the one asked for", async () => {
    // The failure that would be invisible: Over 2.5 booked as Over 3.5 reads identically on a slip.
    const over35: Market = { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 3.5 };
    const dest = fake({
      search: [event()],
      byId: { "sr:match:100": { event: event(), offers: [offer(1.95, over35)] } },
    });
    const sel = selection({ marketType: "OVER_UNDER", outcome: "OVER", line: 2.5 });

    const { draft } = await convertSelection(sel, dest.adapter, aliases, NOW);

    expect(draft.status).toBe("MARKET_NOT_FOUND");
    expect(draft.odds).toBeNull();
  });

  it("takes the line when it does match", async () => {
    const over25: Market = { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 2.5 };
    const dest = fake({
      search: [event()],
      byId: { "sr:match:100": { event: event(), offers: [offer(1.95, over25)] } },
    });
    const sel = selection({ marketType: "OVER_UNDER", outcome: "OVER", line: 2.5 });

    const { draft } = await convertSelection(sel, dest.adapter, aliases, NOW);
    expect(draft.status).toBe("OK");
    expect(draft.odds).toBe(1.95);
  });

  it("refuses a game that has already started, whatever the destination offers", async () => {
    const dest = fake({ search: [event()] });
    const { draft } = await convertSelection(selection(), dest.adapter, aliases, new Date(KICKOFF.getTime() + 1000));

    expect(draft.status).toBe("EVENT_STARTED");
    expect(dest.calls).toEqual([]);
  });
});

describe("a partly converted slip", () => {
  it("prices the legs it carried and recalculates the total from those alone", async () => {
    const other = event({ externalId: "sr:match:400", home: "Spurs", away: "Everton" });
    const dest = fake({
      search: [event(), other],
      byId: {
        "sr:match:100": { event: event(), offers: [offer(1.9)] },
        // Carried, but this destination does not price the market asked for.
        "sr:match:400": { event: other, offers: [offer(1.5, { type: "BTTS", period: "FT", outcome: "YES", line: null })] },
      },
    });

    const legs = [
      selection({ position: 1 }),
      selection({ position: 2, home: "Spurs", away: "Everton" }),
      selection({ position: 3, home: "Brentford", away: "Brighton" }),
    ];
    const results = [];
    for (const leg of legs) results.push(await convertSelection(leg, dest.adapter, aliases, NOW));

    expect(results.map((r) => r.draft.status)).toEqual(["OK", "MARKET_NOT_FOUND", "EVENT_NOT_FOUND"]);

    // The product saveSlip() computes: the total is over the carried legs only, and a leg that
    // could not be carried must not quietly contribute a 1.0 and leave the total looking unchanged.
    const ok = results.filter((r) => r.draft.status === "OK").map((r) => r.draft.odds);
    expect(totalOdds(ok)).toBe(1.9);
    expect(totalOdds(results.map((r) => r.draft.odds))).toBe(1.9);
    // Nothing was dropped: three legs in, three verdicts out.
    expect(results).toHaveLength(3);
  });

  it("reports no total at all when nothing could be carried", async () => {
    const dest = fake();
    const { draft } = await convertSelection(selection(), dest.adapter, aliases, NOW);
    expect(draft.status).toBe("EVENT_NOT_FOUND");
    // Null, not 1.0: a slip with no priced legs has no odds, which is a different statement.
    expect(totalOdds([draft.odds])).toBeNull();
  });
});

describe("drafting never books", () => {
  // convertSelection is the whole of the conversion work and it has no business issuing a code.
  // Every fake above throws if createCode is reached, so this asserts across all of them.
  it("does not touch createCode on any path", async () => {
    const cases: (() => Promise<{ calls: string[] }>)[] = [
      async () => {
        const d = fake({ search: [event()], byId: { "sr:match:100": { event: event(), offers: [offer(1.9)] } } });
        await convertSelection(selection(), d.adapter, aliases, NOW);
        return d;
      },
      async () => {
        const d = fake();
        await convertSelection(selection(), d.adapter, aliases, NOW);
        return d;
      },
      async () => {
        const d = fake({ byId: { "sr:match:100": { event: event({ home: "Everton", away: "Fulham" }), offers: [offer(2)] } } });
        await convertSelection(selection({ externalId: "sr:match:100" }), d.adapter, aliases, NOW);
        return d;
      },
      async () => {
        const d = fake({ search: [event()], byId: { "sr:match:100": { event: event(), offers: [] } } });
        await convertSelection(selection({ marketType: null, outcome: null }), d.adapter, aliases, NOW);
        return d;
      },
    ];

    for (const run of cases) {
      const { calls } = await run();
      expect(calls).not.toContain("createCode");
    }
  });
});
