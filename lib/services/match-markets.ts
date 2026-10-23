import "server-only";
import { mapWithConcurrency } from "@/lib/async";
import { connectedBookmakers } from "@/lib/bookmakers/registry";
import { logger } from "@/lib/logger";
import { marketLabel, pickLabel } from "@/lib/markets/labels";
import { MATCH_THRESHOLD, teamSimilarity } from "@/lib/matching/similarity";
import type { MatchLock } from "@/lib/ai/match-lock";

/**
 * Real prices for one fixture, from the bookmakers that actually list it.
 *
 * The analyst could describe a match in detail and then, asked what it was worth, had to say it
 * could not quote a price - because nothing connected the fixture on screen to the bookmakers we
 * are already integrated with. This is that connection, and nothing more: it reads, it never
 * books, and it never invents a price.
 *
 * Two deliberate limits:
 *
 *  - **Modelled markets only.** A fixture carries roughly 3,700 offers across 278 market types
 *    (see docs/market-coverage.md), almost all of them named in the bookmaker's own private
 *    vocabulary - "1X2 - DrawSave", "Over/Under - GoalRush". Those names can change without
 *    notice, so quoting a price against one risks describing a bet that is not the bet. The nine
 *    types our Market model understands are the ones whose meaning we can stand behind.
 *  - **The rest is named, not priced.** The other market groups are returned as names only, so
 *    the assistant can say truthfully that corners and cards are offered here without inventing
 *    a number for them.
 */

/** How many lines of a repeated market (over/under, handicap) to carry. */
const MAX_LINES = 4;

export type QuotedPick = { pick: string; odds: number };
export type QuotedMarket = { market: string; picks: QuotedPick[] };

export type BookmakerQuote = {
  bookmaker: string;
  /** The fixture as that bookmaker names it, so a mismatch is visible rather than assumed. */
  listedAs: string;
  /**
   * How confidently the bookmaker's fixture was identified as ours, worst side first.
   *
   * Reported rather than kept private: a quote is only as trustworthy as the match behind it, and
   * 0.98 (resolved through an alias) is a different claim from 1.0 (the same name).
   */
  matchConfidence: number;
  markets: QuotedMarket[];
  /**
   * Market groups this bookmaker offers but which carry no price here. Named so they can be
   * mentioned truthfully; being offered is not the same as having a verified current price.
   */
  offeredWithoutPrice: string[];
  totalOffers: number;
  /** When these prices were read. Odds move; a quote without a time is a quote without a claim. */
  pricesReadAt: string;
};

export type MatchMarkets = {
  fixture: string;
  quotes: BookmakerQuote[];
  /** Bookmakers that are connected but do not list this fixture. Said plainly, not hidden. */
  notListedAt: string[];
  /**
   * Bookmakers that returned a fixture we could not confirm is this one, and bookmakers that
   * errored. Kept apart from `notListedAt` because they mean different things: one is "they do
   * not have this game", the other is "we could not be sure", and the second is not a reason to
   * quote a price anyway.
   */
  unverifiedAt: string[];
  erroredAt: string[];
  fetchedAt: string;
};

/** Groups the long tail by its leading words, so 278 names become a handful of honest labels. */
function groupName(raw: string): string {
  const n = raw.toLowerCase();
  if (n.includes("corner")) return "corners";
  if (n.includes("booking") || n.includes("card")) return "cards and bookings";
  if (n.startsWith("player") || n.includes("to score") || n.includes("goalscorer")) return "player markets";
  if (n.includes("1st half") || n.includes("2nd half") || n.includes("ht/ft") || n.includes("halftime")) return "half markets";
  if (n.includes("correct score")) return "correct score";
  return "other specials";
}

export async function marketsForLock(lock: MatchLock, now: Date = new Date()): Promise<MatchMarkets> {
  const fixture = `${lock.home.name} v ${lock.away.name}`;
  const adapters = connectedBookmakers().filter((b) => b.capabilities.events);
  const notListedAt: string[] = [];
  const unverifiedAt: string[] = [];
  const erroredAt: string[] = [];

  const quotes = await mapWithConcurrency(adapters, 3, async (adapter): Promise<BookmakerQuote | null> => {
    try {
      const found = await adapter.searchEvent(lock.home.name, lock.away.name, new Date(lock.kickoffAt));
      if (found.length === 0) {
        notListedAt.push(adapter.name);
        return null;
      }
      const event = found[0];

      /**
       * Checked again here, against the fixture this conversation is locked to.
       *
       * `searchEvent` already matched, but it matched against the names *it* was handed, and this
       * is the one place where quoting the wrong fixture's prices would be invisible: the answer
       * would read perfectly and describe another game. Re-deriving the score from the lock costs
       * nothing and means a price is never reported unless both sides of the fixture were
       * independently confirmed.
       */
      const confidence = Math.min(
        teamSimilarity(lock.home.name, event.home),
        teamSimilarity(lock.away.name, event.away),
      );
      if (confidence < MATCH_THRESHOLD) {
        logger.warn("match_markets.unverified", {
          bookmaker: adapter.slug,
          matchId: lock.matchId,
          wanted: `${lock.home.name} v ${lock.away.name}`,
          got: `${event.home} v ${event.away}`,
          confidence,
        });
        unverifiedAt.push(adapter.name);
        return null;
      }
      const { offers } = await adapter.getEventMarkets(event.externalId);

      const byMarket = new Map<string, QuotedPick[]>();
      const tail = new Set<string>();
      for (const o of offers) {
        if (!o.market || !Number.isFinite(o.odds) || o.odds <= 1) {
          if (!o.market) tail.add(groupName(o.raw.marketName ?? `id ${o.raw.marketId}`));
          continue;
        }
        const label = marketLabel(o.market);
        const picks = byMarket.get(label) ?? [];
        // One price per distinct pick: a bookmaker lists the same outcome under several ids.
        const pick = pickLabel(o.market, event.home, event.away);
        if (!picks.some((p) => p.pick === pick)) picks.push({ pick, odds: o.odds });
        byMarket.set(label, picks);
      }

      const markets = [...byMarket]
        .map(([market, picks]) => ({ market, picks: picks.slice(0, MAX_LINES * 2) }))
        .filter((m) => m.picks.length > 0);

      return {
        bookmaker: adapter.name,
        listedAs: `${event.home} v ${event.away}`,
        matchConfidence: Number(confidence.toFixed(3)),
        markets,
        offeredWithoutPrice: [...tail].sort(),
        totalOffers: offers.length,
        pricesReadAt: now.toISOString(),
      };
    } catch (err) {
      // A bookmaker being unreachable is not the same as it not listing the fixture, and the
      // difference matters to anyone reading the answer.
      logger.warn("match_markets.failed", { bookmaker: adapter.slug, matchId: lock.matchId, err: String(err).slice(0, 200) });
      erroredAt.push(adapter.name);
      return null;
    }
  });

  return {
    fixture,
    quotes: quotes.filter((q): q is BookmakerQuote => q !== null),
    notListedAt,
    unverifiedAt,
    erroredAt,
    fetchedAt: now.toISOString(),
  };
}
