import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// 22Bet (Ghana), on the 1xBet platform (see formats/onex-format.ts).
//
// Live: fixtures and odds are verified against the real feed. Reading and booking codes are
// implemented but NOT verified — no code has been created and read back — so they stay off and
// nothing reaches a user until that check passes.

export const MOCK_CODES: Record<string, MockCode> = {
  ...standardMockCodes({ valid: "22QW7", live: "22LIVE", expired: "22EXP1", down: "22DOWN" }),
};

export function createTwentyTwoBetAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "22bet",
      name: "22Bet",
      codeFormat: /^[A-Z0-9]{4,10}$/,
      format: onexFormat,
      live: {
        load: () => import("@/lib/bookmakers/live/22bet"),
        capabilities: { loadCode: false, createCode: false, events: true },
      },
      mock: { codes: MOCK_CODES, codePrefix: "22", margin: 0.05, eventId: (f) => stableNumber("22bet:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
