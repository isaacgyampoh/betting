import "server-only";
import { createHopegamingClient } from "@/lib/bookmakers/live/hopegaming";

// SportyBet Ghana. The platform client holds the detail; this only says where it lives.
// Verified end to end (booking a code and reading it back) by tests/bookmakers/sportybet-real.test.ts.

const client = createHopegamingClient({
  slug: "sportybet",
  name: "SportyBet",
  baseUrl: "https://www.sportybet.com/api/gh/",
  headers: {
    "user-agent":
      "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    referer: "https://www.sportybet.com/gh/sport/football",
  },
});

export const { fetchEvent, getEventMarkets, getEventOffersWithProbability, listUpcoming, listUpcomingWithOffers, searchEvent, loadCode, createCode } =
  client;

// Pure helpers, shared by every bookmaker on this platform; re-exported so existing imports and
// tests keep working.
export { INLINE_MARKET_IDS, parseSharedSelections, probabilityOf } from "@/lib/bookmakers/live/hopegaming";
export type { FixtureOffer, FixtureWithOffers } from "@/lib/bookmakers/live/hopegaming";
