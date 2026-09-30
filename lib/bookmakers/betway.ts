import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { createLabelFormat } from "@/lib/bookmakers/formats/label-format";
import { createBookmakerAdapter, stableNumber } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// Betway Ghana.
// Mock format is label-based: market names as shown on the site, outcome labels that
// include team names ("Man Utd or Draw"), and the line in `specifier` ("2.5", "-1").
// Replace with the captured live format before switching to live mode.

const betwayFormat = createLabelFormat({
  "Match Result (1X2)": { type: "MATCH_RESULT", period: "FT" },
  "Double Chance": { type: "DOUBLE_CHANCE", period: "FT" },
  "Total Goals Over/Under": { type: "OVER_UNDER", period: "FT" },
  "Both Teams To Score": { type: "BTTS", period: "FT" },
  Handicap: { type: "HANDICAP", period: "FT" },
  "1st Half - Match Result": { type: "MATCH_RESULT", period: "H1" },
  "1st Half - Total Goals": { type: "OVER_UNDER", period: "H1" },
});

export const BETWAY_MOCK_CODES: Record<string, MockCode> = {
  BW5V8N: {
    kind: "valid",
    picks: [
      { fixture: "epl-mun-tot", market: { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 2.5 } },
      { fixture: "lal-bar-ath", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "sea-nap-juv", market: { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_DRAW", line: null } },
      { fixture: "gpl-kot-hoo", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "epl-bha-mci", market: { type: "HANDICAP", period: "FT", outcome: "HOME", line: 1 } },
      { fixture: "gpl-med-dre", market: { type: "OVER_UNDER", period: "H1", outcome: "UNDER", line: 1.5 } },
    ],
  },
  BWLIVE: {
    kind: "valid",
    picks: [
      { fixture: "gpl-bec-ber", market: { type: "BTTS", period: "FT", outcome: "YES", line: null } },
      { fixture: "epl-ars-new", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } },
      { fixture: "sea-int-mil", market: { type: "DOUBLE_CHANCE", period: "FT", outcome: "HOME_AWAY", line: null } },
      {
        fixture: "epl-wol-nfo",
        raw: { marketId: "Total Corners", outcomeId: "Over 9.5", specifier: "9.5", marketName: "Total Corners", outcomeName: "Over 9.5" },
        odds: 1.9,
      },
    ],
  },
  BWEXP1: { kind: "expired" },
  BWDOWN: { kind: "unavailable" },
};

export function createBetwayAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "betway",
      name: "Betway",
      codeFormat: /^[A-Z0-9]{5,10}$/,
      format: betwayFormat,
      mock: { codes: BETWAY_MOCK_CODES, codePrefix: "BW", margin: 0.065, eventId: (f) => stableNumber(`betway:${f.key}`, 9) },
    },
    mode,
    { latencyMs: opts.latencyMs ?? 500 },
  );
}
