import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// PariPesa (Ghana), on the 1xBet platform (see formats/onex-format.ts).
//
// Live: fixtures and odds are verified against the real feed. Reading and booking codes are
// implemented but NOT verified — no code has been created and read back — so they stay off and
// nothing reaches a user until that check passes.

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
      live: {
        load: () => import("@/lib/bookmakers/live/paripesa"),
        capabilities: { loadCode: false, createCode: false, events: true },
      },
      mock: { codes: MOCK_CODES, codePrefix: "PP", margin: 0.055, eventId: (f) => stableNumber("paripesa:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
