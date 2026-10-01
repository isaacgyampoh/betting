import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// 1xBet (Ghana), on the 1xBet platform (see formats/onex-format.ts).
//
// Live: fixtures and odds are verified against the real feed. Reading and booking codes are
// implemented but NOT verified — no code has been created and read back — so they stay off and
// nothing reaches a user until that check passes.

export const MOCK_CODES: Record<string, MockCode> = {
  ...standardMockCodes({ valid: "7KQ2M", live: "7KLIVE", expired: "7KEXP1", down: "7KDOWN" }),
};

export function createOneXBetAdapter(mode: AdapterMode, opts: { latencyMs?: number } = {}): BookmakerAdapter {
  return createBookmakerAdapter(
    {
      slug: "1xbet",
      name: "1xBet",
      codeFormat: /^[A-Z0-9]{4,10}$/,
      format: onexFormat,
      live: {
        load: () => import("@/lib/bookmakers/live/1xbet"),
        capabilities: { loadCode: false, createCode: false, events: true },
      },
      mock: { codes: MOCK_CODES, codePrefix: "7K", margin: 0.045, eventId: (f) => stableNumber("1xbet:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
