import type { Market } from "@/lib/markets/types";

// Bookmakers used in Ghana. Slugs are stable identifiers (DB, API, env var names).
export const BOOKMAKER_SLUGS = [
  "sportybet",
  "betway",
  "1xbet",
  "betpawa",
  "msport",
  "footballcom",
  "betwinner",
  "22bet",
  "paripesa",
] as const;
export type BookmakerSlug = (typeof BOOKMAKER_SLUGS)[number];

export type AdapterMode = "mock" | "live";

export type EventStatus = "NOT_STARTED" | "LIVE" | "ENDED";

/** An event as one bookmaker lists it. */
export type BookmakerEventInfo = {
  externalId: string;
  home: string;
  away: string;
  kickoffAt: Date;
  competition: string | null;
  country: string | null;
  status: EventStatus;
};

/**
 * A bookmaker's own market/outcome reference, flattened to one shape for every bookmaker.
 * It lines up with the market_mappings table (external_market_id, external_outcome_id, specifier).
 */
export type RawMarket = {
  marketId: string;
  outcomeId: string;
  /** Line / specifier as the bookmaker sends it (e.g. "total=2.5"); "" when none. */
  specifier: string;
  marketName?: string;
  outcomeName?: string;
};

export type LoadedSelection = {
  event: BookmakerEventInfo;
  raw: RawMarket;
  /** null when the adapter couldn't map this market; the game is still shown to the user. */
  market: Market | null;
  odds: number | null;
};

export type LoadedSlip = {
  bookmaker: BookmakerSlug;
  code: string;
  selections: LoadedSelection[];
  /** When the booking code stops working, if the bookmaker tells us. */
  expiresAt: Date | null;
};

export type EventMarkets = {
  event: BookmakerEventInfo;
  offers: { raw: RawMarket; market: Market | null; odds: number }[];
};

export type CreateCodeSelection = { eventExternalId: string; market: Market };

export type CreatedCode = { code: string; expiresAt: Date | null };

export interface BookmakerAdapter {
  readonly slug: BookmakerSlug;
  readonly name: string;
  readonly mode: AdapterMode;

  /**
   * Booking-code format, used first when auto-detecting the bookmaker of a pasted code.
   * Assumed until confirmed from captured real codes (docs/capturing-bookmaker-requests.md).
   */
  readonly codeFormat: RegExp;

  /** Normalizes a user-typed code (trim, case). Returns null if the format can't be valid. */
  normalizeCode(code: string): string | null;

  /** Throws AppError INVALID_CODE | EXPIRED_CODE | BOOKMAKER_UNAVAILABLE. */
  loadCode(code: string): Promise<LoadedSlip>;

  /** Books a new slip at the bookmaker and returns its code. */
  createCode(selections: CreateCodeSelection[]): Promise<CreatedCode>;

  /** Finds candidate events for a fixture (kickoff within ±15 minutes). */
  searchEvent(home: string, away: string, kickoff: Date): Promise<BookmakerEventInfo[]>;

  /** All markets and current odds for one event (used to price converted picks). */
  getEventMarkets(eventExternalId: string): Promise<EventMarkets>;

  /** Bookmaker market → internal model. Returns null (never throws) when unknown. */
  mapMarket(raw: RawMarket, event: Pick<BookmakerEventInfo, "home" | "away">): Market | null;

  /** Internal model → bookmaker market. Returns null when this bookmaker doesn't offer it. */
  unmapMarket(market: Market, event: Pick<BookmakerEventInfo, "home" | "away">): RawMarket | null;
}
