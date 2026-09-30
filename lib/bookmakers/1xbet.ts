import type { MockCode } from "@/lib/bookmakers/mock/engine";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import { createBookmakerAdapter, stableNumber, standardMockCodes } from "@/lib/bookmakers/make-adapter";
import type { AdapterMode, BookmakerAdapter } from "@/lib/bookmakers/types";

// 1xBet (Ghana). Uses the 1xBet-platform market format (mock ids; see formats/onex-format.ts).
// Booking-code format assumed until confirmed from captured real codes.

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
      mock: { codes: MOCK_CODES, codePrefix: "7K", margin: 0.045, eventId: (f) => stableNumber("1xbet:" + f.key, 9) },
    },
    mode,
    opts,
  );
}
