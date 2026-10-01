import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// Betwinner (Ghana), on the 1xBet platform (see formats/onex-format.ts).
//
// Live: fixtures and odds are verified against the real feed. Reading and booking codes are
// implemented but NOT verified — no code has been created and read back — so they stay off and
// nothing reaches a user until that check passes.

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
      live: {
        load: () => import("@/lib/bookmakers/live/betwinner"),
        capabilities: { loadCode: false, createCode: false, events: true },
      },
      mock: { codes: MOCK_CODES, codePrefix: "WN", margin: 0.05, eventId: (f) => stableNumber("betwinner:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
