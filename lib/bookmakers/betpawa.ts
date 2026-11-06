import { createLabelFormat } from "@/lib/bookmakers/formats/label-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// betPawa (Ghana). Live for reading booking codes - see lib/bookmakers/live/betpawa.ts, which maps
// markets with its own table rather than the label format below; that one stays for the mock.

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
      live: {
        load: () => import("@/lib/bookmakers/live/betpawa"),
        // Reading only. Creating a booking code is a different endpoint and is not built: this
        // makes betPawa a place a slip can come *from*, which needs nothing from betPawa.
        capabilities: { loadCode: true, createCode: false, events: false },
      },
      mock: { codes: MOCK_CODES, codePrefix: "BP", margin: 0.06, eventId: (f) => stableNumber("betpawa:" + f.key, 8) },
    },
    mode,
    opts,
  );
}
