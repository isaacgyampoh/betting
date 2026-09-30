import { createLabelFormat } from "@/lib/bookmakers/formats/label-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// betPawa (Ghana). Label-based mock format (market names as shown on the site); confirm from a live
// capture before switching to live mode. Booking-code format assumed until confirmed.

const format = createLabelFormat({
  "1X2 - Full Time": { type: "MATCH_RESULT", period: "FT" },
  "Double Chance - Full Time": { type: "DOUBLE_CHANCE", period: "FT" },
  "Over/Under - Full Time": { type: "OVER_UNDER", period: "FT" },
  "Both Teams To Score - Full Time": { type: "BTTS", period: "FT" },
  "Handicap - Full Time": { type: "HANDICAP", period: "FT" },
  "1X2 - 1st Half": { type: "MATCH_RESULT", period: "H1" },
  "Over/Under - 1st Half": { type: "OVER_UNDER", period: "H1" },
});

export const MOCK_CODES = standardMockCodes({ valid: "BP7431", live: "BPLIVE", expired: "BPEXP1", down: "BPDOWN" });

export function createBetPawaAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "betpawa",
      name: "betPawa",
      codeFormat: /^[A-Z0-9]{5,10}$/,
      format,
      mock: { codes: MOCK_CODES, codePrefix: "BP", margin: 0.06, eventId: (f) => stableNumber("betpawa:" + f.key, 8) },
    },
    mode,
    opts,
  );
}
