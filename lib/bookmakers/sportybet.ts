import { createMockBackend, stableNumber, type MockCode, type RawOffer } from "@/lib/bookmakers/mock/engine";
import type { MockPrices } from "@/lib/bookmakers/mock/fixtures";
import { liveNotImplemented } from "@/lib/bookmakers/live-stub";
import type { AdapterMode, BookmakerAdapter, RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

// SportyBet Ghana.
// Market/outcome ids follow the Sportradar-style numbering SportyBet is believed to use
// (1 = 1X2, 18 = Total, ...). Verify against captured live responses before switching to live mode.

type LineKind = "none" | "total" | "hcp";

const MARKETS: Record<string, { type: MarketType; period: MarketPeriod; line: LineKind; outcomes: Record<string, string> }> = {
  "1": { type: "MATCH_RESULT", period: "FT", line: "none", outcomes: { "1": "HOME", "2": "DRAW", "3": "AWAY" } },
  "10": { type: "DOUBLE_CHANCE", period: "FT", line: "none", outcomes: { "9": "HOME_DRAW", "10": "HOME_AWAY", "11": "DRAW_AWAY" } },
  "18": { type: "OVER_UNDER", period: "FT", line: "total", outcomes: { "12": "OVER", "13": "UNDER" } },
  "29": { type: "BTTS", period: "FT", line: "none", outcomes: { "74": "YES", "76": "NO" } },
  "14": { type: "HANDICAP", period: "FT", line: "hcp", outcomes: { "1711": "HOME", "1712": "DRAW", "1713": "AWAY" } },
  "60": { type: "MATCH_RESULT", period: "H1", line: "none", outcomes: { "1": "HOME", "2": "DRAW", "3": "AWAY" } },
  "68": { type: "OVER_UNDER", period: "H1", line: "total", outcomes: { "12": "OVER", "13": "UNDER" } },
};

const MARKET_NAMES: Record<string, string> = {
  "1": "1X2",
  "10": "Double Chance",
  "18": "Over/Under",
  "29": "GG/NG",
  "14": "Handicap",
  "60": "1st Half - 1X2",
  "68": "1st Half - Over/Under",
};

/** "total=2.5" → 2.5; "hcp=0:1" → -1 (home line = home goals − away goals). */
export function parseSpecifier(kind: LineKind, specifier: string): number | null | undefined {
  if (kind === "none") return specifier === "" ? null : undefined;
  if (kind === "total") {
    const m = specifier.match(/^total=(\d+(?:\.\d+)?)$/);
    return m ? Number(m[1]) : undefined;
  }
  const m = specifier.match(/^hcp=(\d+):(\d+)$/);
  return m ? Number(m[1]) - Number(m[2]) : undefined;
}

function formatSpecifier(kind: LineKind, line: number | null): string | undefined {
  if (kind === "none") return line === null ? "" : undefined;
  if (line === null) return undefined;
  if (kind === "total") return `total=${line}`;
  return line < 0 ? `hcp=0:${-line}` : `hcp=${line}:0`;
}

function mapMarket(raw: RawMarket): Market | null {
  const def = MARKETS[raw.marketId];
  const outcome = def?.outcomes[raw.outcomeId];
  if (!def || !outcome) return null;
  const line = parseSpecifier(def.line, raw.specifier);
  if (line === undefined) return null;
  return { type: def.type, period: def.period, outcome, line };
}

function unmapMarket(market: Market): RawMarket | null {
  for (const [marketId, def] of Object.entries(MARKETS)) {
    if (def.type !== market.type || def.period !== market.period) continue;
    const outcomeId = Object.keys(def.outcomes).find((k) => def.outcomes[k] === market.outcome);
    const specifier = formatSpecifier(def.line, market.line);
    if (!outcomeId || specifier === undefined) return null;
    return { marketId, outcomeId, specifier, marketName: MARKET_NAMES[marketId] };
  }
  return null;
}

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
    const spec = formatSpecifier("hcp", Number(line))!;
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

export function createSportyBetAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  const mock = createMockBackend(
    {
      slug: "sportybet",
      margin: 0.05,
      eventId: (f) => `sr:match:${stableNumber(f.key, 8)}`,
      offers: (_f, prices) => mockOffers(prices),
      codes: SPORTYBET_MOCK_CODES,
      codePrefix: "BC",
      latencyMs: opts.latencyMs ?? 400,
    },
    () => adapter,
  );

  const adapter: BookmakerAdapter = {
    slug: "sportybet",
    name: "SportyBet",
    mode,
    normalizeCode(code) {
      const c = code.replace(/\s+/g, "").toUpperCase();
      return /^[A-Z0-9]{4,12}$/.test(c) ? c : null;
    },
    loadCode: (code) => (mode === "mock" ? mock.loadCode(code) : liveNotImplemented("sportybet", "loadCode")),
    createCode: (s) => (mode === "mock" ? mock.createCode(s) : liveNotImplemented("sportybet", "createCode")),
    searchEvent: (h, a, k) => (mode === "mock" ? mock.searchEvent(h, a, k) : liveNotImplemented("sportybet", "searchEvent")),
    getEventMarkets: (id) => (mode === "mock" ? mock.getEventMarkets(id) : liveNotImplemented("sportybet", "getEventMarkets")),
    mapMarket: (raw) => mapMarket(raw),
    unmapMarket: (market) => unmapMarket(market),
  };
  return adapter;
}
