import type { MarketPeriod as DbMarketPeriod, MarketType as DbMarketType } from "@/lib/generated/prisma/enums";

// Internal market model shared by every bookmaker adapter. Kept free of Prisma runtime
// imports so it can be used in client components; the checks below keep it in sync with the DB enums.

export const MARKET_TYPES = [
  "MATCH_RESULT",
  "DOUBLE_CHANCE",
  "DRAW_NO_BET",
  "OVER_UNDER",
  "BTTS",
  "HANDICAP",
  "ASIAN_HANDICAP",
  "CORRECT_SCORE",
  "HT_FT",
  "ODD_EVEN",
  "TEAM_OVER_UNDER",
] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

export const MARKET_PERIODS = ["FT", "H1", "H2"] as const;
export type MarketPeriod = (typeof MARKET_PERIODS)[number];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _typesInSync: Same<MarketType, DbMarketType> = true;
const _periodsInSync: Same<MarketPeriod, DbMarketPeriod> = true;
void _typesInSync;
void _periodsInSync;

/** Outcome keys per market. HANDICAP lines are always from the home team's perspective. */
export const OUTCOMES = {
  MATCH_RESULT: ["HOME", "DRAW", "AWAY"],
  DOUBLE_CHANCE: ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"],
  DRAW_NO_BET: ["HOME", "AWAY"],
  OVER_UNDER: ["OVER", "UNDER"],
  BTTS: ["YES", "NO"],
  HANDICAP: ["HOME", "DRAW", "AWAY"],
  ASIAN_HANDICAP: ["HOME", "AWAY"],
  ODD_EVEN: ["ODD", "EVEN"],
  TEAM_OVER_UNDER: ["HOME_OVER", "HOME_UNDER", "AWAY_OVER", "AWAY_UNDER"],
} as const satisfies Partial<Record<MarketType, readonly string[]>>;

/** A single pick in our internal model, e.g. { OVER_UNDER, H1, OVER, 1.5 }. */
export type Market = {
  type: MarketType;
  period: MarketPeriod;
  outcome: string;
  /** Goal line for totals, home-team handicap for handicaps; null otherwise. */
  line: number | null;
};

export function sameMarket(a: Market, b: Market): boolean {
  return a.type === b.type && a.period === b.period && a.outcome === b.outcome && (a.line ?? null) === (b.line ?? null);
}
