import type { RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

// Betradar/Sportradar market model: numeric market ids, numeric outcome ids and a `specifier`
// string carrying the line ("total=2.5", "hcp=0:1"). Used by SportyBet and, on inspection, by
// several other operators running the same feed.
//
// Every id below was read off real responses from
//   GET /api/gh/factsCenter/event?eventId={sr:match:N}&productId=3
// captured 2026-10-01 (see docs/capturing-bookmaker-requests.md). Do not add an id by analogy
// with another market: Betradar reuses outcome ids inconsistently across markets, so an
// unverified guess silently mis-prices a pick. Leaving a market unmapped is safe — the pick is
// still shown to the user with the bookmaker's own label, it just can't be converted.

/** How a market's line is encoded in `specifier`. */
type LineKind =
  | "none" // no specifier
  | "total" // total=2.5
  | "hcp3way" // hcp=0:1  (three-way handicap; line is home goals − away goals)
  | "hcpAsian"; // hcp=-3.5 (two-way handicap; line is already home-relative)

type MarketDef = {
  type: MarketType;
  period: MarketPeriod;
  line: LineKind;
  name: string;
  /** Betradar outcome id → our outcome key. */
  outcomes: Record<string, string>;
};

const RESULT = { "1": "HOME", "2": "DRAW", "3": "AWAY" };
const DOUBLE = { "9": "HOME_DRAW", "10": "HOME_AWAY", "11": "DRAW_AWAY" };
const DNB = { "4": "HOME", "5": "AWAY" };
const TOTAL = { "12": "OVER", "13": "UNDER" };
const YES_NO = { "74": "YES", "76": "NO" };
const ODD_EVEN = { "70": "ODD", "72": "EVEN" };
const HCP_3WAY = { "1711": "HOME", "1712": "DRAW", "1713": "AWAY" };
const HCP_ASIAN = { "1714": "HOME", "1715": "AWAY" };
const teamTotal = (side: "HOME" | "AWAY") => ({ "12": `${side}_OVER`, "13": `${side}_UNDER` });

export const BETRADAR_MARKETS: Record<string, MarketDef> = {
  // --- Full time ---
  "1": { type: "MATCH_RESULT", period: "FT", line: "none", name: "1X2", outcomes: RESULT },
  "10": { type: "DOUBLE_CHANCE", period: "FT", line: "none", name: "Double Chance", outcomes: DOUBLE },
  "11": { type: "DRAW_NO_BET", period: "FT", line: "none", name: "Draw No Bet", outcomes: DNB },
  "14": { type: "HANDICAP", period: "FT", line: "hcp3way", name: "Handicap", outcomes: HCP_3WAY },
  "16": { type: "ASIAN_HANDICAP", period: "FT", line: "hcpAsian", name: "Asian Handicap", outcomes: HCP_ASIAN },
  "18": { type: "OVER_UNDER", period: "FT", line: "total", name: "Over/Under", outcomes: TOTAL },
  "19": { type: "TEAM_OVER_UNDER", period: "FT", line: "total", name: "Home O/U", outcomes: teamTotal("HOME") },
  "20": { type: "TEAM_OVER_UNDER", period: "FT", line: "total", name: "Away O/U", outcomes: teamTotal("AWAY") },
  "26": { type: "ODD_EVEN", period: "FT", line: "none", name: "Odd/Even", outcomes: ODD_EVEN },
  "29": { type: "BTTS", period: "FT", line: "none", name: "GG/NG", outcomes: YES_NO },

  // --- First half ---
  "60": { type: "MATCH_RESULT", period: "H1", line: "none", name: "1st Half - 1X2", outcomes: RESULT },
  "63": { type: "DOUBLE_CHANCE", period: "H1", line: "none", name: "1st Half - Double Chance", outcomes: DOUBLE },
  "64": { type: "DRAW_NO_BET", period: "H1", line: "none", name: "1st Half - Draw No Bet", outcomes: DNB },
  "65": { type: "HANDICAP", period: "H1", line: "hcp3way", name: "1st Half - Handicap", outcomes: HCP_3WAY },
  "66": { type: "ASIAN_HANDICAP", period: "H1", line: "hcpAsian", name: "1st Half - Asian Handicap", outcomes: HCP_ASIAN },
  "68": { type: "OVER_UNDER", period: "H1", line: "total", name: "1st Half - Over/Under", outcomes: TOTAL },
  "69": { type: "TEAM_OVER_UNDER", period: "H1", line: "total", name: "1st Half - Home O/U", outcomes: teamTotal("HOME") },
  "70": { type: "TEAM_OVER_UNDER", period: "H1", line: "total", name: "1st Half - Away O/U", outcomes: teamTotal("AWAY") },
  "74": { type: "ODD_EVEN", period: "H1", line: "none", name: "1st Half - Odd/Even", outcomes: ODD_EVEN },
  "75": { type: "BTTS", period: "H1", line: "none", name: "1st Half - GG/NG", outcomes: YES_NO },

  // --- Second half ---
  "83": { type: "MATCH_RESULT", period: "H2", line: "none", name: "2nd Half - 1X2", outcomes: RESULT },
  "85": { type: "DOUBLE_CHANCE", period: "H2", line: "none", name: "2nd Half - Double Chance", outcomes: DOUBLE },
  "86": { type: "DRAW_NO_BET", period: "H2", line: "none", name: "2nd Half - Draw No Bet", outcomes: DNB },
  "87": { type: "HANDICAP", period: "H2", line: "hcp3way", name: "2nd Half - Handicap", outcomes: HCP_3WAY },
  "88": { type: "ASIAN_HANDICAP", period: "H2", line: "hcpAsian", name: "2nd Half - Asian Handicap", outcomes: HCP_ASIAN },
  "90": { type: "OVER_UNDER", period: "H2", line: "total", name: "2nd Half - Total", outcomes: TOTAL },
  "91": { type: "TEAM_OVER_UNDER", period: "H2", line: "total", name: "2nd Half - Home Total", outcomes: teamTotal("HOME") },
  "92": { type: "TEAM_OVER_UNDER", period: "H2", line: "total", name: "2nd Half - Away Total", outcomes: teamTotal("AWAY") },
  "94": { type: "ODD_EVEN", period: "H2", line: "none", name: "2nd Half - Odd/Even", outcomes: ODD_EVEN },
  "95": { type: "BTTS", period: "H2", line: "none", name: "2nd Half - GG/NG", outcomes: YES_NO },
};

/** `undefined` means "this specifier doesn't belong to this market", which is a mapping failure. */
export function parseSpecifier(kind: LineKind, specifier: string): number | null | undefined {
  if (kind === "none") return specifier === "" ? null : undefined;
  if (kind === "total") {
    const m = specifier.match(/^total=(\d+(?:\.\d+)?)$/);
    return m ? Number(m[1]) : undefined;
  }
  if (kind === "hcpAsian") {
    const m = specifier.match(/^hcp=([+-]?\d+(?:\.\d+)?)$/);
    return m ? Number(m[1]) : undefined;
  }
  // hcp3way: "hcp=0:1" is a head start, so the home-relative line is home − away.
  const m = specifier.match(/^hcp=(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) - Number(m[2]) : undefined;
}

export function formatSpecifier(kind: LineKind, line: number | null): string | undefined {
  if (kind === "none") return line === null ? "" : undefined;
  if (line === null) return undefined;
  if (kind === "total") return `total=${line}`;
  // Both SportyBet and MSport write a positive asian line bare ("hcp=0.5"), never "hcp=+0.5".
  // Emitting the plus sign books a different line or fails outright, so keep it off.
  if (kind === "hcpAsian") return `hcp=${line}`;
  return line < 0 ? `hcp=0:${-line}` : `hcp=${line}:0`;
}

export function mapBetradarMarket(raw: RawMarket): Market | null {
  const def = BETRADAR_MARKETS[raw.marketId];
  const outcome = def?.outcomes[raw.outcomeId];
  if (!def || !outcome) return null;
  const line = parseSpecifier(def.line, raw.specifier);
  if (line === undefined) return null;
  return { type: def.type, period: def.period, outcome, line };
}

export function unmapBetradarMarket(market: Market): RawMarket | null {
  for (const [marketId, def] of Object.entries(BETRADAR_MARKETS)) {
    if (def.type !== market.type || def.period !== market.period) continue;
    const outcomeId = Object.keys(def.outcomes).find((k) => def.outcomes[k] === market.outcome);
    if (!outcomeId) continue; // e.g. TEAM_OVER_UNDER: the home market can't price an away outcome.
    const specifier = formatSpecifier(def.line, market.line);
    if (specifier === undefined) return null;
    return { marketId, outcomeId, specifier, marketName: def.name, outcomeName: def.outcomes[outcomeId] };
  }
  return null;
}

/** The market name a bookmaker shows, for picks we deliberately leave unmapped. */
export function betradarMarketName(marketId: string): string | undefined {
  return BETRADAR_MARKETS[marketId]?.name;
}
