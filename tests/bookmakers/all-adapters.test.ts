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
    await expect(adapter.loadCode("ZZZZZZ9")).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("maps every offered market both ways (bookmaker format ⇄ internal model)", async () => {
    const slip = await adapter.loadCode(valid);
    const { event, offers } = await adapter.getEventMarkets(slip.selections[0].event.externalId);
    expect(offers.length).toBeGreaterThan(15);
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

  it("live mode is unavailable, never guessed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(createAdapter(slug, "live").loadCode(valid)).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE" });
    err.mockRestore();
  });
});
