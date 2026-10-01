import { createMockBackend, stableNumber, type MockCode, type RawOffer } from "@/lib/bookmakers/mock/engine";
import type { MockPrices } from "@/lib/bookmakers/mock/fixtures";
import {
  BETRADAR_MARKETS,
  formatSpecifier,
  mapBetradarMarket,
  unmapBetradarMarket,
} from "@/lib/bookmakers/formats/betradar-format";
import { liveNotImplemented } from "@/lib/bookmakers/live-stub";
import type { AdapterMode, BookmakerAdapter, RawMarket } from "@/lib/bookmakers/types";

// SportyBet Ghana.
//
// Market and outcome ids come from lib/bookmakers/formats/betradar-format.ts and were read off
// real SportyBet responses on 2026-10-01, so mock and live speak exactly the same dialect.
// Live reads (booking codes, fixtures, odds) are implemented in lib/bookmakers/live/sportybet.ts.
//
// createCode is still unimplemented: booking a slip is a POST we have not captured, and guessing
// it would mean silently failing to place a real bet. Converting *to* SportyBet therefore still
// reports the bookmaker as unavailable rather than pretending to have booked something.

const MARKET_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(BETRADAR_MARKETS).map(([id, def]) => [id, def.name]),
);

// --- Mock data ---------------------------------------------------------------

function mockOffers(prices: MockPrices): RawOffer[] {
  const o = (marketId: string, outcomeId: string, specifier: string, odds: number, outcomeName: string): RawOffer => ({
    raw: { marketId, outcomeId, specifier, marketName: MARKET_NAMES[marketId] ?? marketId, outcomeName },
    odds,
  });
  const offers: RawOffer[] = [
    o("1", "1", "", prices.matchResult[0], "Home"),
    o("1", "2", "", prices.matchResult[1], "Draw"),
    o("1", "3", "", prices.matchResult[2], "Away"),
    o("10", "9", "", prices.doubleChance[0], "Home or Draw"),
    o("10", "10", "", prices.doubleChance[1], "Home or Away"),
    o("10", "11", "", prices.doubleChance[2], "Draw or Away"),
    o("29", "74", "", prices.btts[0], "Yes"),
    o("29", "76", "", prices.btts[1], "No"),
    o("60", "1", "", prices.firstHalfResult[0], "Home"),
    o("60", "2", "", prices.firstHalfResult[1], "Draw"),
    o("60", "3", "", prices.firstHalfResult[2], "Away"),
  ];
  for (const [line, [over, under]] of Object.entries(prices.overUnder)) {
    offers.push(o("18", "12", `total=${line}`, over, `Over ${line}`), o("18", "13", `total=${line}`, under, `Under ${line}`));
  }
  for (const [line, [over, under]] of Object.entries(prices.firstHalfOverUnder)) {
    offers.push(o("68", "12", `total=${line}`, over, `Over ${line}`), o("68", "13", `total=${line}`, under, `Under ${line}`));
  }
  for (const [line, [h, d, a]] of Object.entries(prices.handicap)) {
    const spec = formatSpecifier("hcp3way", Number(line))!;
    const away = Number(line) > 0 ? `-${line}` : `+${-Number(line)}`;
    const home = Number(line) > 0 ? `+${line}` : line;
    offers.push(o("14", "1711", spec, h, `Home (${home})`), o("14", "1712", spec, d, `Draw (${home})`), o("14", "1713", spec, a, `Away (${away})`));
  }
  return offers;
}

/** Test codes: see README "Mock booking codes". */
export const SPORTYBET_MOCK_CODES: Record<string, MockCode> = {
  BC7K2Q: {
    kind: "valid",
    picks: [
      { fixture: "epl-mun-tot", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "epl-ars-new", market: { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_DRAW", line: null } },
      { fixture: "epl-wol-nfo", market: { type: "OVER_UNDER", period: "FT", outcome: "UNDER", line: 2.5 } },
      { fixture: "epl-bha-mci", market: { type: "BTTS", period: "FT", outcome: "YES", line: null } },
      { fixture: "lal-atm-bet", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "sea-int-mil", market: { type: "OVER_UNDER", period: "H1", outcome: "OVER", line: 0.5 } },
      { fixture: "gpl-kot-hoo", market: { type: "HANDICAP", period: "FT", outcome: "HOME", line: 1 } },
      { fixture: "gpl-nat-kar", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
    ],
  },
  BCLIVE: {
    kind: "valid",
    picks: [
      { fixture: "gpl-bec-ber", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "gpl-med-dre", market: { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_DRAW", line: null } },
      { fixture: "sea-nap-juv", market: { type: "BTTS", period: "FT", outcome: "NO", line: null } },
      {
        fixture: "lal-bar-ath",
        raw: { marketId: "166", outcomeId: "12", specifier: "total=9.5", marketName: "Total Corners", outcomeName: "Over 9.5" },
        odds: 1.85,
      },
    ],
  },
  BCEXP1: { kind: "expired" },
  BCDOWN: { kind: "unavailable" },
};

// Assumed booking-code format; confirm from captured real codes.
const SPORTYBET_CODE = /^[A-Z0-9]{5,10}$/;

export function createSportyBetAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  const mock = createMockBackend(
    {
      slug: "sportybet",
      name: "SportyBet",
      margin: 0.05,
      eventId: (f) => `sr:match:${stableNumber(f.key, 8)}`,
      offers: (_f, prices) => mockOffers(prices),
      codes: SPORTYBET_MOCK_CODES,
      codePrefix: "BC",
      latencyMs: opts.latencyMs ?? 400,
    },
    () => adapter,
  );

  const live = () => import("@/lib/bookmakers/live/sportybet");

  const adapter: BookmakerAdapter = {
    slug: "sportybet",
    name: "SportyBet",
    mode,
    // Live: reading codes, fixtures and odds is verified against the real API
    // (tests/bookmakers/sportybet-real.test.ts). Booking a new code is a POST we have not
    // captured, so it stays off rather than failing a user mid-conversion.
    capabilities: mode === "mock" ? { loadCode: true, createCode: true, events: true } : { loadCode: true, createCode: false, events: true },
    codeFormat: SPORTYBET_CODE,
    normalizeCode(code) {
      const c = code.replace(/\s+/g, "").toUpperCase();
      return SPORTYBET_CODE.test(c) ? c : null;
    },
    // The live client is server-only, so it is pulled in on demand rather than at module load.
    loadCode: async (code) => (mode === "mock" ? mock.loadCode(code) : (await live()).loadCode(code)),
    createCode: (s) => (mode === "mock" ? mock.createCode(s) : liveNotImplemented("sportybet", "createCode")),
    searchEvent: async (h, a, k) => (mode === "mock" ? mock.searchEvent(h, a, k) : (await live()).searchEvent(h, a, k)),
    getEventMarkets: async (id) => (mode === "mock" ? mock.getEventMarkets(id) : (await live()).getEventMarkets(id)),
    mapMarket: (raw) => mapBetradarMarket(raw),
    unmapMarket: (market) => unmapBetradarMarket(market),
  };
  return adapter;
}
