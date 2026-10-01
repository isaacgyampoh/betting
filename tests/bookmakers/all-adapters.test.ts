import { describe, expect, it, vi } from "vitest";
import { createAdapter } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS, type BookmakerSlug } from "@/lib/bookmakers/types";

// Mock codes per bookmaker: [valid, started-game, expired, outage].
const CODES: Record<BookmakerSlug, [string, string, string, string]> = {
  sportybet: ["BC7K2Q", "BCLIVE", "BCEXP1", "BCDOWN"],
  betway: ["BW5V8N", "BWLIVE", "BWEXP1", "BWDOWN"],
  "1xbet": ["7KQ2M", "7KLIVE", "7KEXP1", "7KDOWN"],
  betpawa: ["BP7431", "BPLIVE", "BPEXP1", "BPDOWN"],
  msport: ["MS6120", "MSLIVE", "MSEXP1", "MSDOWN"],
  footballcom: ["FB2Q7X", "FBLIVE", "FBEXP1", "FBDOWN"],
  betwinner: ["WN83K", "WNLIVE", "WNEXP1", "WNDOWN"],
  "22bet": ["22QW7", "22LIVE", "22EXP1", "22DOWN"],
  paripesa: ["PP51Q", "PPLIVE", "PPEXP1", "PPDOWN"],
};

describe.each(BOOKMAKER_SLUGS)("%s mock adapter", (slug) => {
  const adapter = createAdapter(slug, "mock", { latencyMs: 0 });
  const [valid, live, expired, down] = CODES[slug];

  it("loads its valid code with every market mapped and priced", async () => {
    const slip = await adapter.loadCode(valid);
    expect(slip.bookmaker).toBe(slug);
    expect(slip.selections.length).toBeGreaterThanOrEqual(5);
    for (const s of slip.selections) {
      expect(s.market, JSON.stringify(s.raw)).not.toBeNull();
      expect(s.odds).toBeGreaterThan(1);
    }
  });

  it("flags a started game", async () => {
    const slip = await adapter.loadCode(live);
    expect(slip.selections.some((s) => s.event.status === "LIVE")).toBe(true);
  });

  it("reports expired and outage codes", async () => {
    await expect(adapter.loadCode(expired)).rejects.toMatchObject({ code: "EXPIRED_CODE" });
    await expect(adapter.loadCode(down)).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    await expect(adapter.loadCode("ZZZZZZ9")).rejects.toMatchObject({ code: "BOOKMAKER_NOT_CONNECTED" });
  });

  it("maps every offered market both ways (bookmaker format ⇄ internal model)", async () => {
    const slip = await adapter.loadCode(valid);
    const { event, offers } = await adapter.getEventMarkets(slip.selections[0].event.externalId);
    // A mock only offers what its format can really express, so the 1xBet-platform bookmakers
    // offer fewer: their mapping is limited to the markets that have been verified against live
    // data. The assertion that matters is the round-trip below, not the count.
    expect(offers.length).toBeGreaterThanOrEqual(12);
    for (const o of offers) {
      expect(o.market, JSON.stringify(o.raw)).not.toBeNull();
      const back = adapter.unmapMarket(o.market!, event);
      expect({ m: back?.marketId, o: back?.outcomeId, s: back?.specifier }).toEqual({ m: o.raw.marketId, o: o.raw.outcomeId, s: o.raw.specifier });
    }
  });

  it("books a new code that loads back", async () => {
    const slip = await adapter.loadCode(valid);
    const picks = slip.selections.slice(0, 2).map((s) => ({ eventExternalId: s.event.externalId, market: s.market! }));
    const created = await adapter.createCode(picks);
    expect((await adapter.loadCode(created.code)).selections.map((s) => s.market)).toEqual(picks.map((p) => p.market));
  });

  it("rejects obviously invalid code formats", () => {
    expect(adapter.normalizeCode("a!")).toBeNull();
    expect(adapter.normalizeCode(" " + valid.toLowerCase() + " ")).toBe(valid);
  });

  it("declares every capability in mock mode", () => {
    expect(adapter.capabilities).toEqual({ loadCode: true, createCode: true, events: true });
  });
});

// A bookmaker is only allowed to claim a live capability once the matching real request has been
// captured and verified. Anything it does not claim must fail loudly rather than invent data.
describe("live mode claims nothing it cannot do", () => {
  const VERIFIED: Partial<Record<BookmakerSlug, { loadCode: boolean; createCode: boolean; events: boolean }>> = {
    // Verified 2026-10-01 against the real API, including booking a code and reading it back.
    sportybet: { loadCode: true, createCode: true, events: true },
    msport: { loadCode: true, createCode: true, events: true },
    footballcom: { loadCode: true, createCode: true, events: true },
    // 1xBet platform: fixtures and odds verified; booking implemented but never checked end to end,
    // so it stays off.
    "1xbet": { loadCode: false, createCode: false, events: true },
    paripesa: { loadCode: false, createCode: false, events: true },
    "22bet": { loadCode: false, createCode: false, events: true },
    betwinner: { loadCode: false, createCode: false, events: true },
  };

  it.each(BOOKMAKER_SLUGS)("%s declares only verified capabilities", (slug) => {
    const expected = VERIFIED[slug] ?? { loadCode: false, createCode: false, events: false };
    expect(createAdapter(slug, "live").capabilities).toEqual(expected);
  });

  // Unconnected bookmakers: every operation must report unavailability instead of guessing.
  const unconnected = BOOKMAKER_SLUGS.filter((s) => !VERIFIED[s]);
  it.each(unconnected)("%s refuses every live operation", async (slug) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = createAdapter(slug, "live");
    await expect(a.loadCode(CODES[slug][0])).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    await expect(a.getEventMarkets("whatever")).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    await expect(a.searchEvent("A", "B", new Date())).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    err.mockRestore();
  });

  // A bookmaker that can read prices but not codes must still refuse the code operations, even
  // though its live client implements them.
  const pricesOnly = BOOKMAKER_SLUGS.filter((s) => VERIFIED[s]?.events && !VERIFIED[s]?.loadCode);
  it.each(pricesOnly)("%s reads prices but refuses booking codes", async (slug) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = createAdapter(slug, "live");
    await expect(a.loadCode(CODES[slug][0])).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    await expect(a.createCode([])).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    err.mockRestore();
  });

  it("only a verified bookmaker claims it can book a code", () => {
    for (const slug of BOOKMAKER_SLUGS) {
      expect(createAdapter(slug, "live").capabilities.createCode, slug).toBe(VERIFIED[slug]?.createCode ?? false);
    }
  });
});
