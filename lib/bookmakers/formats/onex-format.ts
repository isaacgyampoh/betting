import type { RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

// The numeric market format used by the platform behind 1xBet, PariPesa, 22Bet and Betwinner.
// A bet is a market group `G`, an outcome type `T` and an optional line `P`, which we carry as
// marketId "G<group>", outcomeId "T<type>", specifier "P=<line>".
//
// These bookmakers ship **no labels at all** — a bet is `{"T":1,"C":1.22,"G":1}` — so unlike
// SportyBet there is nothing to read the meaning off. Every mapping below was therefore derived
// and then checked, on 2026-10-01:
//
//  * Structure comes from the platform's own table in its betting bundle, which declares which
//    outcome types make up each group:  vn = {1:[1,2,3], 2:[7,8], 8:[4,5,6], 14:[182,183],
//    15:[11,12], 17:[9,10], 62:[13,14], ...}
//  * Meaning was then confirmed against a bookmaker that *does* label its data (SportyBet), on the
//    same fixture at the same moment, and against the platform's own arithmetic. For example
//    double chance 12 must price at 1/(1/1.22 + 1/14.70) = 1.126 from its own 1X2, and T5 was 1.12.
//
// Corroborating prices, Germany v Serbia, 2026-10-01 (1xBet vs SportyBet):
//   G1  T1/T2/T3        1.22 / 6.95 / 14.70   vs  Home 1.20, Draw 8.32, Away 14.41
//   G14 T182/T183       1.83 / 1.87           vs  GG/NG Yes 1.87, No 1.94
//   G15 T11 P1.5/P2.5   1.22 / 1.65           vs  Home O/U Over 1.5 1.21, Over 2.5 1.66
//   G62 T13 P0.5/P1.5   1.80 / 4.40           vs  Away O/U Over 0.5 1.78, Over 1.5 4.90
//
// Anything not listed here stays unmapped. A fixture carries over 200 market groups and guessing
// one would silently book a different bet, so markets are added only when they have been checked
// the same way.

type LineKind =
  | "none" // no P
  | "total" // P is a goals line
  | "hcpOwnSide"; // P is the handicap from *that outcome's* side, not the home team's

type GroupDef = {
  type: MarketType;
  period: MarketPeriod;
  line: LineKind;
  name: string;
  outcomes: Record<string, string>;
};

const GROUPS: Record<string, GroupDef> = {
  G1: { type: "MATCH_RESULT", period: "FT", line: "none", name: "1X2", outcomes: { T1: "HOME", T2: "DRAW", T3: "AWAY" } },
  G8: {
    type: "DOUBLE_CHANCE",
    period: "FT",
    line: "none",
    name: "Double Chance",
    outcomes: { T4: "HOME_DRAW", T5: "HOME_AWAY", T6: "DRAW_AWAY" },
  },
  G17: { type: "OVER_UNDER", period: "FT", line: "total", name: "Total", outcomes: { T9: "OVER", T10: "UNDER" } },
  G14: { type: "BTTS", period: "FT", line: "none", name: "Both Teams To Score", outcomes: { T182: "YES", T183: "NO" } },
  // 1xBet writes an asian handicap from each side's own point of view: T7 P-1 and T8 P+1 are the
  // same bet. Our model keeps the line home-relative, so the away side's is negated on the way in.
  G2: { type: "ASIAN_HANDICAP", period: "FT", line: "hcpOwnSide", name: "Handicap", outcomes: { T7: "HOME", T8: "AWAY" } },
  G15: {
    type: "TEAM_OVER_UNDER",
    period: "FT",
    line: "total",
    name: "Home Total",
    outcomes: { T11: "HOME_OVER", T12: "HOME_UNDER" },
  },
  G62: {
    type: "TEAM_OVER_UNDER",
    period: "FT",
    line: "total",
    name: "Away Total",
    outcomes: { T13: "AWAY_OVER", T14: "AWAY_UNDER" },
  },
};

const isAway = (outcome: string) => outcome === "AWAY" || outcome.startsWith("AWAY_");

function parseLine(def: GroupDef, outcome: string, specifier: string): number | null | undefined {
  if (def.line === "none") return specifier === "" ? null : undefined;
  const m = specifier.match(/^P=([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const value = Number(m[1]);
  // An away handicap of +1 is a home handicap of -1.
  return def.line === "hcpOwnSide" && isAway(outcome) ? -value : value;
}

function formatLine(def: GroupDef, outcome: string, line: number | null): string | undefined {
  if (def.line === "none") return line === null ? "" : undefined;
  if (line === null) return undefined;
  return `P=${def.line === "hcpOwnSide" && isAway(outcome) ? -line : line}`;
}

export const onexFormat = {
  mapMarket(raw: RawMarket): Market | null {
    const def = GROUPS[raw.marketId];
    const outcome = def?.outcomes[raw.outcomeId];
    if (!def || !outcome) return null;
    const line = parseLine(def, outcome, raw.specifier);
    return line === undefined ? null : { type: def.type, period: def.period, outcome, line };
  },

  unmapMarket(market: Market): RawMarket | null {
    for (const [marketId, def] of Object.entries(GROUPS)) {
      if (def.type !== market.type || def.period !== market.period) continue;
      const outcomeId = Object.keys(def.outcomes).find((k) => def.outcomes[k] === market.outcome);
      if (!outcomeId) continue; // e.g. the home-total group cannot express an away outcome.
      const specifier = formatLine(def, market.outcome, market.line);
      if (specifier === undefined) return null;
      return { marketId, outcomeId, specifier, marketName: def.name, outcomeName: market.outcome };
    }
    return null;
  },
};

/** The platform's own group → outcome-type table, kept for checking the mapping against live data. */
export const ONEX_GROUP_TYPES: Record<string, number[]> = {
  G1: [1, 2, 3],
  G2: [7, 8],
  G8: [4, 5, 6],
  G14: [182, 183],
  G15: [11, 12],
  G17: [9, 10],
  G62: [13, 14],
};
