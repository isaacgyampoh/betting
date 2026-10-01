import { createMockBackend, stableNumber, type MockCode, type RawOffer } from "@/lib/bookmakers/mock/engine";
import type { MockFixture, MockPrices } from "@/lib/bookmakers/mock/fixtures";
import { liveNotImplemented } from "@/lib/bookmakers/live-stub";
import type { AdapterMode, BookmakerAdapter, BookmakerSlug, RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

// Builds a BookmakerAdapter from a market format, a booking-code pattern and mock data. Every
// adapter keeps the same interface; the live branch stays unimplemented until real requests for
// that bookmaker have been captured (docs/capturing-bookmaker-requests.md).

type Teams = { home: string; away: string };

export type MarketFormat = {
  mapMarket(raw: RawMarket, teams: Teams): Market | null;
  unmapMarket(market: Market, teams: Teams): RawMarket | null;
};

/** Every market in the internal model the mocks price, expressed in the bookmaker's own format. */
export function standardOffers(prices: MockPrices, teams: Teams, format: MarketFormat): RawOffer[] {
  const offers: RawOffer[] = [];
  const add = (type: MarketType, period: MarketPeriod, outcome: string, line: number | null, odds: number) => {
    const raw = format.unmapMarket({ type, period, outcome, line }, teams);
    if (raw) offers.push({ raw, odds });
  };
  ["HOME", "DRAW", "AWAY"].forEach((o, i) => add("MATCH_RESULT", "FT", o, null, prices.matchResult[i]));
  ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"].forEach((o, i) => add("DOUBLE_CHANCE", "FT", o, null, prices.doubleChance[i]));
  ["YES", "NO"].forEach((o, i) => add("BTTS", "FT", o, null, prices.btts[i]));
  ["HOME", "DRAW", "AWAY"].forEach((o, i) => add("MATCH_RESULT", "H1", o, null, prices.firstHalfResult[i]));
  for (const [line, [over, under]] of Object.entries(prices.overUnder)) {
    add("OVER_UNDER", "FT", "OVER", Number(line), over);
    add("OVER_UNDER", "FT", "UNDER", Number(line), under);
  }
  for (const [line, [over, under]] of Object.entries(prices.firstHalfOverUnder)) {
    add("OVER_UNDER", "H1", "OVER", Number(line), over);
    add("OVER_UNDER", "H1", "UNDER", Number(line), under);
  }
  for (const [line, odds] of Object.entries(prices.handicap)) {
    ["HOME", "DRAW", "AWAY"].forEach((o, i) => add("HANDICAP", "FT", o, Number(line), odds[i]));
  }
  return offers;
}

const m = (type: MarketType, period: MarketPeriod, outcome: string, line: number | null = null): Market => ({ type, period, outcome, line });

/** Standard mock booking codes: a valid slip, a slip with a started game, an expired and an "outage" code. */
export function standardMockCodes(codes: { valid: string; live: string; expired: string; down: string }): Record<string, MockCode> {
  return {
    [codes.valid]: {
      kind: "valid",
      picks: [
        { fixture: "epl-mun-tot", market: m("DOUBLE_CHANCE", "FT", "HOME_DRAW") },
        { fixture: "epl-ars-new", market: m("MATCH_RESULT", "FT", "HOME") },
        { fixture: "lal-bar-ath", market: m("OVER_UNDER", "FT", "OVER", 1.5) },
        { fixture: "sea-int-mil", market: m("BTTS", "FT", "YES") },
        { fixture: "gpl-kot-hoo", market: m("DOUBLE_CHANCE", "FT", "HOME_DRAW") },
        { fixture: "epl-bha-mci", market: m("MATCH_RESULT", "FT", "AWAY") },
      ],
    },
    [codes.live]: {
      kind: "valid",
      picks: [
        { fixture: "gpl-bec-ber", market: m("MATCH_RESULT", "FT", "HOME") },
        { fixture: "sea-nap-juv", market: m("OVER_UNDER", "FT", "UNDER", 2.5) },
        { fixture: "lal-atm-bet", market: m("DOUBLE_CHANCE", "FT", "HOME_DRAW") },
      ],
    },
    [codes.expired]: { kind: "expired" },
    [codes.down]: { kind: "unavailable" },
  };
}

export type BookmakerDefinition = {
  slug: BookmakerSlug;
  name: string;
  codeFormat: RegExp;
  format: MarketFormat;
  mock: {
    codes: Record<string, MockCode>;
    codePrefix: string;
    margin: number;
    eventId: (f: MockFixture) => string;
    offers?: (f: MockFixture, prices: MockPrices, names: [string, string]) => RawOffer[];
  };
};

export function createBookmakerAdapter(def: BookmakerDefinition, mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  const mock = createMockBackend(
    {
      slug: def.slug,
      name: def.name,
      margin: def.mock.margin,
      eventId: def.mock.eventId,
      offers: def.mock.offers ?? ((_f, prices, [home, away]) => standardOffers(prices, { home, away }, def.format)),
      codes: def.mock.codes,
      codePrefix: def.mock.codePrefix,
      latencyMs: opts.latencyMs ?? 450,
    },
    () => adapter,
  );
  const live = (op: string) => liveNotImplemented(def.slug, op);

  const adapter: BookmakerAdapter = {
    slug: def.slug,
    name: def.name,
    mode,
    codeFormat: def.codeFormat,
    normalizeCode(code) {
      const c = code.replace(/[\s-]+/g, "").toUpperCase();
      return def.codeFormat.test(c) ? c : null;
    },
    loadCode: (code) => (mode === "mock" ? mock.loadCode(code) : live("loadCode")),
    createCode: (s) => (mode === "mock" ? mock.createCode(s) : live("createCode")),
    searchEvent: (h, a, k) => (mode === "mock" ? mock.searchEvent(h, a, k) : live("searchEvent")),
    getEventMarkets: (id) => (mode === "mock" ? mock.getEventMarkets(id) : live("getEventMarkets")),
    mapMarket: (raw, event) => def.format.mapMarket(raw, event),
    unmapMarket: (market, event) => def.format.unmapMarket(market, event),
  };
  return adapter;
}

export { stableNumber };
