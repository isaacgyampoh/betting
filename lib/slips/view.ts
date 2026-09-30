import { marketLabel, pickLabel } from "@/lib/markets/labels";
import type { SlipRisk } from "@/lib/slips/risk";
import type { Market } from "@/lib/markets/types";

// API response shapes for slips. Pure and client-safe: shared by services, API and UI.

export type SelectionStatus = "OK" | "EVENT_NOT_FOUND" | "MARKET_NOT_FOUND" | "EVENT_STARTED" | "UNSUPPORTED_MARKET";

export const STATUS_REASON: Record<Exclude<SelectionStatus, "OK">, string> = {
  EVENT_NOT_FOUND: "Game not found on this bookmaker",
  MARKET_NOT_FOUND: "Game found, but this market isn't offered",
  EVENT_STARTED: "Game already started, so it can't be booked",
  UNSUPPORTED_MARKET: "Market not supported yet",
};

export type SelectionView = {
  position: number;
  eventExternalId: string | null;
  home: string;
  away: string;
  competition: string | null;
  kickoffAt: string; // ISO
  started: boolean;
  market: Market | null;
  marketLabel: string;
  pickLabel: string;
  odds: number | null;
  status: SelectionStatus;
  /** Club crests (API-Football), when known. */
  homeLogo?: string | null;
  awayLogo?: string | null;
  /** Odds of the same pick on the parent slip (conversions), for comparison. */
  sourceOdds?: number | null;
};

export type SlipWarningCode = "STARTED" | "UNMAPPED_MARKET" | "MISSING_ODDS" | "NOT_CONVERTED";
export type SlipWarning = { code: SlipWarningCode; message: string; positions: number[] };

export type SlipView = {
  id: string;
  bookmaker: { slug: string; name: string };
  /** Sample bookmaker data (mock adapter): the code won't work on the real bookmaker site. */
  demo: boolean;
  code: string | null;
  kind: string;
  totalOdds: number | null;
  selectionCount: number;
  expiresAt: string | null;
  createdAt: string;
  parent: { id: string; bookmaker: { slug: string; name: string }; code: string | null } | null;
  selections: SelectionView[];
  warnings: SlipWarning[];
  /** How likely every pick is to land, from the prices. */
  risk: SlipRisk;
};

export type SlipSummary = {
  id: string;
  bookmaker: { slug: string; name: string };
  code: string | null;
  kind: string;
  totalOdds: number | null;
  selectionCount: number;
  createdAt: string;
};

export type SelectionInput = {
  position: number;
  eventExternalId: string | null;
  home: string;
  away: string;
  competition: string | null;
  kickoffAt: Date;
  market: Market | null;
  rawMarketName: string | null;
  rawOutcomeName: string | null;
  odds: number | null;
  status?: SelectionStatus;
  sourceOdds?: number | null;
};

/** Product of all odds, rounded to 2 dp. Null when no selection has odds. */
export function totalOdds(odds: (number | null)[]): number | null {
  const known = odds.filter((o): o is number => typeof o === "number" && o > 0);
  if (known.length === 0) return null;
  return Math.round(known.reduce((acc, o) => acc * o, 1) * 100) / 100;
}

export function toSelectionView(s: SelectionInput, now = new Date()): SelectionView {
  return {
    position: s.position,
    eventExternalId: s.eventExternalId,
    home: s.home,
    away: s.away,
    competition: s.competition,
    kickoffAt: s.kickoffAt.toISOString(),
    started: s.kickoffAt.getTime() <= now.getTime(),
    market: s.market,
    marketLabel: s.market ? marketLabel(s.market) : (s.rawMarketName ?? "Unknown market"),
    pickLabel: s.market ? pickLabel(s.market, s.home, s.away) : (s.rawOutcomeName ?? "Unknown pick"),
    odds: s.odds,
    status: s.status ?? "OK",
    ...(s.sourceOdds !== undefined ? { sourceOdds: s.sourceOdds } : {}),
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildWarnings(all: SelectionView[]): SlipWarning[] {
  const warnings: SlipWarning[] = [];
  const skipped = all.filter((s) => s.status !== "OK").map((s) => s.position);
  if (skipped.length) {
    warnings.push({
      code: "NOT_CONVERTED",
      positions: skipped,
      message: `${skipped.length} ${plural(skipped.length, "game", "games")} couldn't be carried over and ${plural(skipped.length, "is", "are")} not on the new code. See the reasons below.`,
    });
  }
  const selections = all.filter((s) => s.status === "OK");
  const started = selections.filter((s) => s.started).map((s) => s.position);
  if (started.length) {
    warnings.push({
      code: "STARTED",
      positions: started,
      message: `${started.length} ${plural(started.length, "game has", "games have")} already started. The bookmaker may reject the slip or void ${plural(started.length, "it", "them")}.`,
    });
  }
  const unmapped = selections.filter((s) => !s.market).map((s) => s.position);
  if (unmapped.length) {
    warnings.push({
      code: "UNMAPPED_MARKET",
      positions: unmapped,
      message: `${unmapped.length} ${plural(unmapped.length, "pick uses a market", "picks use markets")} we don't support yet. ${plural(unmapped.length, "It", "They")} can't be converted or edited.`,
    });
  }
  const missing = selections.filter((s) => s.odds === null).map((s) => s.position);
  if (missing.length) {
    warnings.push({
      code: "MISSING_ODDS",
      positions: missing,
      message: `Odds are missing for ${missing.length} ${plural(missing.length, "pick", "picks")}; total odds exclude ${plural(missing.length, "it", "them")}.`,
    });
  }
  return warnings;
}
