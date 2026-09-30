import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// PariPesa (Ghana). Uses the 1xBet-platform market format (mock ids; see formats/onex-format.ts).
// Booking-code format assumed until confirmed from captured real codes.

export const MOCK_CODES: Record<string, MockCode> = {
  ...standardMockCodes({ valid: "PP51Q", live: "PPLIVE", expired: "PPEXP1", down: "PPDOWN" }),
  SHARED7: { kind: "valid", picks: [{ fixture: "epl-ars-new", market: { type: "MATCH_RESULT", period: "FT", outcome: "HOME", line: null } }] },
};

export function createPariPesaAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "paripesa",
      name: "PariPesa",
      codeFormat: /^[A-Z0-9]{4,10}$/,
      format: onexFormat,
      mock: { codes: MOCK_CODES, codePrefix: "PP", margin: 0.055, eventId: (f) => stableNumber("paripesa:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
