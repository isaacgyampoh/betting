import "server-only";
import { createHopegamingClient } from "@/lib/bookmakers/live/hopegaming";

// Football.com Ghana. It runs the same platform as SportyBet with identical paths — the same
// factsCenter endpoints, the same `orders/share`, the same Betradar market ids and the same
// Sportradar event ids — so a pick carries between them by id and only the price differs.
// Verified by tests/bookmakers/footballcom-real.test.ts.

const client = createHopegamingClient({
  slug: "footballcom",
  name: "Football.com",
  baseUrl: "https://www.football.com/api/gh/",
  headers: {
    "user-agent":
      "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    referer: "https://www.football.com/gh/",
  },
});

export const { fetchEvent, getEventMarkets, getEventOffersWithProbability, listUpcoming, listUpcomingWithOffers, searchEvent, loadCode, createCode } =
  client;
