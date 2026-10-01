import { mapBetradarMarket, unmapBetradarMarket } from "@/lib/bookmakers/formats/betradar-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// MSport (Ghana).
//
// MSport runs the same platform as SportyBet, so it speaks the same Betradar market/outcome ids and
// the same Sportradar event ids — which is what makes conversion between the two real rather than a
// best-effort name match. Mock mode uses that same dialect so it behaves like live.
//
// Live requests are verified against the real API; see lib/bookmakers/live/msport.ts.

const format = { mapMarket: (raw: Parameters<typeof mapBetradarMarket>[0]) => mapBetradarMarket(raw), unmapMarket: unmapBetradarMarket };

export const MOCK_CODES = standardMockCodes({ valid: "MS6120", live: "MSLIVE", expired: "MSEXP1", down: "MSDOWN" });

export function createMSportAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "msport",
      name: "MSport",
      codeFormat: /^[A-Z0-9]{5,10}$/,
      format,
      live: {
        load: () => import("@/lib/bookmakers/live/msport"),
        capabilities: { loadCode: true, createCode: true, events: true },
      },
      mock: {
        codes: MOCK_CODES,
        codePrefix: "MS",
        margin: 0.06,
        // Same Sportradar id space as the real site.
        eventId: (f) => `sr:match:${stableNumber("msport:" + f.key, 8)}`,
      },
    },
    mode,
    opts,
  );
}
