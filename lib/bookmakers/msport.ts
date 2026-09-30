import { createLabelFormat } from "@/lib/bookmakers/formats/label-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// MSport (Ghana). Label-based mock format (market names as shown on the site); confirm from a live
// capture before switching to live mode. Booking-code format assumed until confirmed.

const format = createLabelFormat({
  "1X2": { type: "MATCH_RESULT", period: "FT" },
  "Double Chance": { type: "DOUBLE_CHANCE", period: "FT" },
  "Over/Under": { type: "OVER_UNDER", period: "FT" },
  "GG/NG": { type: "BTTS", period: "FT" },
  Handicap: { type: "HANDICAP", period: "FT" },
  "1st Half 1X2": { type: "MATCH_RESULT", period: "H1" },
  "1st Half Over/Under": { type: "OVER_UNDER", period: "H1" },
});

export const MOCK_CODES = standardMockCodes({ valid: "MS6120", live: "MSLIVE", expired: "MSEXP1", down: "MSDOWN" });

export function createMSportAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "msport",
      name: "MSport",
      codeFormat: /^[A-Z0-9]{5,10}$/,
      format,
      mock: { codes: MOCK_CODES, codePrefix: "MS", margin: 0.06, eventId: (f) => stableNumber("msport:" + f.key, 8) },
    },
    mode,
    opts,
  );
}
