import { mapBetradarMarket, unmapBetradarMarket } from "@/lib/bookmakers/formats/betradar-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// Football.com (Ghana).
//
// Same platform as SportyBet, so it speaks the Betradar market ids and the Sportradar event ids,
// and mock mode uses that dialect too. Live requests are in lib/bookmakers/live/footballcom.ts.

const format = { mapMarket: (raw: Parameters<typeof mapBetradarMarket>[0]) => mapBetradarMarket(raw), unmapMarket: unmapBetradarMarket };

export const MOCK_CODES = standardMockCodes({ valid: "FB2Q7X", live: "FBLIVE", expired: "FBEXP1", down: "FBDOWN" });

export function createFootballComAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "footballcom",
      name: "Football.com",
      codeFormat: /^[A-Z0-9]{5,10}$/,
      format,
      live: {
        load: () => import("@/lib/bookmakers/live/footballcom"),
        capabilities: { loadCode: true, createCode: true, events: true },
      },
      mock: {
        codes: MOCK_CODES,
        codePrefix: "FB",
        margin: 0.06,
        eventId: (f) => `sr:match:${stableNumber("footballcom:" + f.key, 8)}`,
      },
    },
    mode,
    opts,
  );
}
