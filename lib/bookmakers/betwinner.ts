import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// Betwinner (Ghana). Uses the 1xBet-platform market format (mock ids; see formats/onex-format.ts).
// Booking-code format assumed until confirmed from captured real codes.

export const MOCK_CODES: Record<string, MockCode> = {
  ...standardMockCodes({ valid: "WN83K", live: "WNLIVE", expired: "WNEXP1", down: "WNDOWN" }),
  // Also exists on PariPesa: exercises "ask which bookmaker" when a code is valid on two.
  SHARED7: { kind: "valid", picks: [{ fixture: "epl-ars-new", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } }] },
};

export function createBetwinnerAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "betwinner",
      name: "Betwinner",
      codeFormat: /^[A-Z0-9]{4,10}$/,
      format: onexFormat,
      mock: { codes: MOCK_CODES, codePrefix: "WN", margin: 0.05, eventId: (f) => stableNumber("betwinner:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
