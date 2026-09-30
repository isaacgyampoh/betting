import type { RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";
import { normalizeTeamName } from "@/lib/matching/normalize";

// Label-based market format: market names as shown on the site, outcome labels that include team
// names ("Man Utd or Draw"), and the line in `specifier` ("2.5", "-1"). Used by bookmakers whose
// slips identify picks by text rather than numeric ids (as mocked until live captures exist).

export type Teams = { home: string; away: string };
export type LabelMarkets = Record<string, { type: MarketType; period: MarketPeriod }>;

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

export function createLabelFormat(markets: LabelMarkets) {
  function mapMarket(raw: RawMarket, t: Teams): Market | null {
    const def = markets[raw.marketId];
    if (!def) return null;
    const label = raw.outcomeId.trim();
    switch (def.type) {
      case "MATCH_RESULT": {
        const outcome = side(label, t);
        return outcome && raw.specifier === "" ? { ...def, outcome, line: null } : null;
      }
      case "DOUBLE_CHANCE": {
        const key = label.split(/\s+or\s+/i).map((p) => side(p, t)).join("_");
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
    const marketId = Object.keys(markets).find((k) => markets[k].type === market.type && markets[k].period === market.period);
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

  return { mapMarket, unmapMarket };
}
