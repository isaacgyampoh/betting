import type { BookmakerAdapter, BookmakerEventInfo, RawMarket } from "@/lib/bookmakers/types";
import type { Market } from "@/lib/markets/types";
import { logger } from "@/lib/logger";

/** Maps a raw market, logging (never throwing) when the adapter doesn't know it. */
export function mapOrLog(
  adapter: Pick<BookmakerAdapter, "slug" | "mapMarket">,
  raw: RawMarket,
  event: Pick<BookmakerEventInfo, "home" | "away" | "externalId">,
): Market | null {
  let market: Market | null = null;
  try {
    market = adapter.mapMarket(raw, event);
  } catch (err) {
    logger.error("bookmaker.map_market_threw", { bookmaker: adapter.slug, raw, err });
  }
  if (!market) {
    logger.warn("bookmaker.unmapped_market", {
      bookmaker: adapter.slug,
      eventId: event.externalId,
      marketId: raw.marketId,
      outcomeId: raw.outcomeId,
      specifier: raw.specifier,
      marketName: raw.marketName,
      outcomeName: raw.outcomeName,
    });
  }
  return market;
}
