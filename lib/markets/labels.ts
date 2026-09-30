import type { Market } from "@/lib/markets/types";

const PERIOD_PREFIX = { FT: "", H1: "1st Half ", H2: "2nd Half " } as const;

function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}

/** Human label for the market, e.g. "1st Half Over/Under 1.5". */
export function marketLabel(m: Market): string {
  const p = PERIOD_PREFIX[m.period];
  switch (m.type) {
    case "MATCH_RESULT":
      return `${p}1X2`;
    case "DOUBLE_CHANCE":
      return `${p}Double Chance`;
    case "DRAW_NO_BET":
      return `${p}Draw No Bet`;
    case "OVER_UNDER":
      return `${p}Over/Under ${m.line ?? ""}`.trim();
    case "BTTS":
      return `${p}Both Teams to Score`;
    case "HANDICAP":
      return `${p}Handicap ${m.line !== null ? `(Home ${signed(m.line)})` : ""}`.trim();
    case "ASIAN_HANDICAP":
      return `${p}Asian Handicap`;
    default:
      return `${p}${m.type.replaceAll("_", " ").toLowerCase()}`;
  }
}

/** Human label for the pick, using team names where it helps, e.g. "Arsenal or Draw". */
export function pickLabel(m: Market, home: string, away: string): string {
  const line = m.line ?? 0;
  switch (m.type) {
    case "MATCH_RESULT":
    case "DRAW_NO_BET":
      return m.outcome === "HOME" ? home : m.outcome === "AWAY" ? away : "Draw";
    case "DOUBLE_CHANCE":
      return m.outcome === "HOME_DRAW" ? `${home} or Draw` : m.outcome === "DRAW_AWAY" ? `Draw or ${away}` : `${home} or ${away}`;
    case "OVER_UNDER":
      return `${m.outcome === "OVER" ? "Over" : "Under"} ${m.line}`;
    case "BTTS":
      return m.outcome === "YES" ? "Yes" : "No";
    case "HANDICAP":
      if (m.outcome === "HOME") return `${home} (${signed(line)})`;
      if (m.outcome === "AWAY") return `${away} (${signed(-line)})`;
      return `Draw (${signed(line)})`;
    default:
      return m.outcome;
  }
}
