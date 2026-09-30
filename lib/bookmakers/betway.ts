import { createMockBackend, stableNumber, type MockCode, type RawOffer } from "@/lib/bookmakers/mock/engine";
import type { MockPrices } from "@/lib/bookmakers/mock/fixtures";
import { liveNotImplemented } from "@/lib/bookmakers/live-stub";
import { normalizeTeamName } from "@/lib/matching/normalize";
import type { AdapterMode, BookmakerAdapter, RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

// Betway Ghana.
// Mock format is label-based: market names as shown on the site, outcome labels that
// include team names ("Man Utd or Draw"), and the line in `specifier` ("2.5", "-1").
// Replace with the captured live format before switching to live mode.

type Teams = { home: string; away: string };

const MARKETS: Record<string, { type: MarketType; period: MarketPeriod }> = {
  "Match Result (1X2)": { type: "MATCH_RESULT", period: "FT" },
  "Double Chance": { type: "DOUBLE_CHANCE", period: "FT" },
  "Total Goals Over/Under": { type: "OVER_UNDER", period: "FT" },
  "Both Teams To Score": { type: "BTTS", period: "FT" },
  Handicap: { type: "HANDICAP", period: "FT" },
  "1st Half - Match Result": { type: "MATCH_RESULT", period: "H1" },
  "1st Half - Total Goals": { type: "OVER_UNDER", period: "H1" },
};

const eq = (a: string, b: string) => normalizeTeamName(a) === normalizeTeamName(b);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function side(label: string, t: Teams): "HOME" | "DRAW" | "AWAY" | null {
  if (eq(label, "Draw")) return "DRAW";
  if (eq(label, t.home)) return "HOME";
  if (eq(label, t.away)) return "AWAY";
  return null;
}

function parseLine(specifier: string): number | null {
  return /^[+-]?\d+(\.\d+)?$/.test(specifier) ? Number(specifier) : null;
}

function mapMarket(raw: RawMarket, t: Teams): Market | null {
  const def = MARKETS[raw.marketId];
  if (!def) return null;
  const label = raw.outcomeId.trim();

  switch (def.type) {
    case "MATCH_RESULT": {
      const outcome = side(label, t);
      return outcome && raw.specifier === "" ? { ...def, outcome, line: null } : null;
    }
    case "DOUBLE_CHANCE": {
      const parts = label.split(/\s+or\s+/i).map((p) => side(p, t));
      const key = parts.join("_");
      const outcome = { HOME_DRAW: "HOME_DRAW", HOME_AWAY: "HOME_AWAY", DRAW_AWAY: "DRAW_AWAY" }[key];
      return outcome ? { ...def, outcome, line: null } : null;
    }
    case "OVER_UNDER": {
      const line = parseLine(raw.specifier);
      const m = label.match(/^(Over|Under)\b/i);
      return m && line !== null ? { ...def, outcome: m[1].toUpperCase(), line } : null;
    }
    case "BTTS":
      return /^(yes|no)$/i.test(label) ? { ...def, outcome: label.toUpperCase(), line: null } : null;
    case "HANDICAP": {
      const line = parseLine(raw.specifier);
      const outcome = side(label.replace(/\s*\([+-]?\d+(\.\d+)?\)$/, ""), t);
      return outcome && line !== null ? { ...def, outcome, line } : null;
    }
    default:
      return null;
  }
}

function unmapMarket(market: Market, t: Teams): RawMarket | null {
  const marketId = Object.keys(MARKETS).find((k) => MARKETS[k].type === market.type && MARKETS[k].period === market.period);
  if (!marketId) return null;
  const name = (o: string) => (o === "HOME" ? t.home : o === "AWAY" ? t.away : "Draw");
  const base = { marketId, marketName: marketId };

  switch (market.type) {
    case "MATCH_RESULT":
      return { ...base, outcomeId: name(market.outcome), outcomeName: name(market.outcome), specifier: "" };
    case "DOUBLE_CHANCE": {
      const label = market.outcome.split("_").map(name).join(" or ");
      return { ...base, outcomeId: label, outcomeName: label, specifier: "" };
    }
    case "OVER_UNDER": {
      if (market.line === null) return null;
      const label = `${market.outcome === "OVER" ? "Over" : "Under"} ${market.line}`;
      return { ...base, outcomeId: label, outcomeName: label, specifier: String(market.line) };
    }
    case "BTTS": {
      const label = market.outcome === "YES" ? "Yes" : "No";
      return { ...base, outcomeId: label, outcomeName: label, specifier: "" };
    }
    case "HANDICAP": {
      if (market.line === null) return null;
      const shown = market.outcome === "AWAY" ? -market.line : market.line;
      const label = `${name(market.outcome)} (${signed(shown)})`;
      return { ...base, outcomeId: label, outcomeName: label, specifier: signed(market.line) };
    }
    default:
      return null;
  }
}

// --- Mock data ---------------------------------------------------------------

function mockOffers(prices: MockPrices, t: Teams): RawOffer[] {
  const offers: RawOffer[] = [];
  const add = (market: Market, odds: number) => {
    const raw = unmapMarket(market, t);
    if (raw) offers.push({ raw, odds });
  };
  const m = (type: MarketType, period: MarketPeriod, outcome: string, line: number | null = null): Market => ({ type, period, outcome, line });

  ["HOME", "DRAW", "AWAY"].forEach((o, i) => add(m("MATCH_RESULT", "FT", o), prices.matchResult[i]));
  ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"].forEach((o, i) => add(m("DOUBLE_CHANCE", "FT", o), prices.doubleChance[i]));
  ["YES", "NO"].forEach((o, i) => add(m("BTTS", "FT", o), prices.btts[i]));
  ["HOME", "DRAW", "AWAY"].forEach((o, i) => add(m("MATCH_RESULT", "H1", o), prices.firstHalfResult[i]));
  for (const [line, [over, under]] of Object.entries(prices.overUnder)) {
    add(m("OVER_UNDER", "FT", "OVER", Number(line)), over);
    add(m("OVER_UNDER", "FT", "UNDER", Number(line)), under);
  }
  for (const [line, [over, under]] of Object.entries(prices.firstHalfOverUnder)) {
    add(m("OVER_UNDER", "H1", "OVER", Number(line)), over);
    add(m("OVER_UNDER", "H1", "UNDER", Number(line)), under);
  }
  for (const [line, odds] of Object.entries(prices.handicap)) {
    ["HOME", "DRAW", "AWAY"].forEach((o, i) => add(m("HANDICAP", "FT", o, Number(line)), odds[i]));
  }
  return offers;
}

export const BETWAY_MOCK_CODES: Record<string, MockCode> = {
  BW5V8N: {
    kind: "valid",
    picks: [
      { fixture: "epl-mun-tot", market: { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 2.5 } },
      { fixture: "lal-bar-ath", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "sea-nap-juv", market: { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_DRAW", line: null } },
      { fixture: "gpl-kot-hoo", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "epl-bha-mci", market: { type: "HANDICAP", period: "FT", outcome: "HOME", line: 1 } },
      { fixture: "gpl-med-dre", market: { type: "OVER_UNDER", period: "H1", outcome: "UNDER", line: 1.5 } },
    ],
  },
  BWLIVE: {
    kind: "valid",
    picks: [
      { fixture: "gpl-bec-ber", market: { type: "BTTS", period: "FT", outcome: "YES", line: null } },
      { fixture: "epl-ars-new", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "sea-int-mil", market: { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_AWAY", line: null } },
      {
        fixture: "epl-wol-nfo",
        raw: { marketId: "Total Corners", outcomeId: "Over 9.5", specifier: "9.5", marketName: "Total Corners", outcomeName: "Over 9.5" },
        odds: 1.9,
      },
    ],
  },
  BWEXP1: { kind: "expired" },
  BWDOWN: { kind: "unavailable" },
};

export function createBetwayAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  const mock = createMockBackend(
    {
      slug: "betway",
      margin: 0.065,
      eventId: (f) => stableNumber(`betway:${f.key}`, 9),
      offers: (_f, prices, [home, away]) => mockOffers(prices, { home, away }),
      codes: BETWAY_MOCK_CODES,
      codePrefix: "BW",
      latencyMs: opts.latencyMs ?? 500,
    },
    () => adapter,
  );

  const adapter: BookmakerAdapter = {
    slug: "betway",
    name: "Betway",
    mode,
    normalizeCode(code) {
      const c = code.replace(/\s+/g, "").toUpperCase();
      return /^[A-Z0-9]{4,12}$/.test(c) ? c : null;
    },
    loadCode: (code) => (mode === "mock" ? mock.loadCode(code) : liveNotImplemented("betway", "loadCode")),
    createCode: (s) => (mode === "mock" ? mock.createCode(s) : liveNotImplemented("betway", "createCode")),
    searchEvent: (h, a, k) => (mode === "mock" ? mock.searchEvent(h, a, k) : liveNotImplemented("betway", "searchEvent")),
    mapMarket: (raw, event) => mapMarket(raw, event),
    unmapMarket: (market, event) => unmapMarket(market, event),
  };
  return adapter;
}
