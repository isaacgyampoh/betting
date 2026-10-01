import "server-only";
import { createOnexClient } from "@/lib/bookmakers/live/onex";

// 22Bet (Ghana), on the 1xBet platform. The client holds the detail; this only says where it lives.
// Fixtures and odds are verified; booking is not — see the note in live/onex.ts.

export const { fetchGame, getEventMarkets, listUpcoming, listUpcomingWithOffers, searchEvent, loadCode, createCode } =
  createOnexClient({ slug: "22bet", name: "22Bet", baseUrl: "https://22bet.com.gh" });
