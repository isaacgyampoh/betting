import { createLabelFormat } from "@/lib/bookmakers/formats/label-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// Football.com (Ghana). Label-based mock format (market names as shown on the site); confirm from a live
// capture before switching to live mode. Booking-code format assumed until confirmed.

const format = createLabelFormat({
  "Full Time Result": { type: "MATCH_RESULT", period: "FT" },
  "Double Chance": { type: "DOUBLE_CHANCE", period: "FT" },
  "Goals Over/Under": { type: "OVER_UNDER", period: "FT" },
  "Both Teams To Score": { type: "BTTS", period: "FT" },
  Handicap: { type: "HANDICAP", period: "FT" },
  "Half Time Result": { type: "MATCH_RESULT", period: "H1" },
  "1st Half Goals": { type: "OVER_UNDER", period: "H1" },
});

export const MOCK_CODES = standardMockCodes({ valid: "FB2Q7X", live: "FBLIVE", expired: "FBEXP1", down: "FBDOWN" });

export function createFootballComAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "footballcom",
      name: "Football.com",
      codeFormat: /^[A-Z0-9]{5,10}$/,
      format,
      mock: { codes: MOCK_CODES, codePrefix: "FB", margin: 0.055, eventId: (f) => stableNumber("footballcom:" + f.key, 8) },
    },
    mode,
    opts,
  );
}
