import type { RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

// Numeric group/type format used by the bookmaker platform behind 1xBet, Betwinner, PariPesa and
// 22Bet (they are widely reported to share it): marketId = "G<group>", outcomeId = "T<type>",
// specifier = "P=<line>". The ids below are a MOCK modelled on that style; confirm every id from a
// captured real response before switching any of these bookmakers to live mode.

type LineKind = "none" | "line";
const GROUPS: Record<string, { type: MarketType; period: MarketPeriod; line: LineKind; outcomes: Record<string, string> }> = {
  G1: { type: "MATCH_RESULT", period: "FT", line: "none", outcomes: { T1: "HOME", T2: "DRAW", T3: "AWAY" } },
  G8: { type: "DOUBLE_CHANCE", period: "FT", line: "none", outcomes: { T4: "HOME_DRAW", T5: "HOME_AWAY", T6: "DRAW_AWAY" } },
  G17: { type: "OVER_UNDER", period: "FT", line: "line", outcomes: { T9: "OVER", T10: "UNDER" } },
  G19: { type: "BTTS", period: "FT", line: "none", outcomes: { T180: "YES", T181: "NO" } },
  G27: { type: "HANDICAP", period: "FT", line: "line", outcomes: { T424: "HOME", T425: "DRAW", T426: "AWAY" } },
  G11: { type: "MATCH_RESULT", period: "H1", line: "none", outcomes: { T1: "HOME", T2: "DRAW", T3: "AWAY" } },
  G15: { type: "OVER_UNDER", period: "H1", line: "line", outcomes: { T9: "OVER", T10: "UNDER" } },
};

const GROUP_NAMES: Record<string, string> = {
  G1: "1X2",
  G8: "Double chance",
  G17: "Total",
  G19: "Both teams to score",
  G27: "Handicap",
  G11: "1st half 1X2",
  G15: "1st half total",
};

function parseLine(kind: LineKind, specifier: string): number | null | undefined {
  if (kind === "none") return specifier === "" ? null : undefined;
  const m = specifier.match(/^P=([+-]?\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : undefined;
}

export const onexFormat = {
  mapMarket(raw: RawMarket): Market | null {
    const def = GROUPS[raw.marketId];
    const outcome = def?.outcomes[raw.outcomeId];
    if (!def || !outcome) return null;
    const line = parseLine(def.line, raw.specifier);
    return line === undefined ? null : { type: def.type, period: def.period, outcome, line };
  },
  unmapMarket(market: Market): RawMarket | null {
    for (const [marketId, def] of Object.entries(GROUPS)) {
      if (def.type !== market.type || def.period !== market.period) continue;
      const outcomeId = Object.keys(def.outcomes).find((k) => def.outcomes[k] === market.outcome);
      if (!outcomeId) return null;
      if (def.line === "line" && market.line === null) return null;
      if (def.line === "none" && market.line !== null) return null;
      const specifier = def.line === "line" ? `P=${market.line}` : "";
      return { marketId, outcomeId, specifier, marketName: GROUP_NAMES[marketId], outcomeName: `${market.outcome}${market.line !== null ? ` ${market.line}` : ""}` };
    }
    return null;
  },
};
