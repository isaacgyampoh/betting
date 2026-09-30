import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { extractSlipFromFile, type ExtractedSlip, type UploadedFile } from "@/lib/ai/extract-slip";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { searchMatches } from "@/lib/services/stats";
import { requireFeature } from "@/lib/services/ai-quota";
import { enforceRateLimit } from "@/lib/services/usage";
import type { MatchSummary } from "@/lib/stats/types";

export const UPLOAD_LIMIT = { limit: 20, windowMs: 60 * 60_000 };

export type ReadRow = {
  index: number;
  /** Exactly as printed on the slip. */
  read: { home: string | null; away: string | null; market: string | null; pick: string | null; odds: number | null; confidence: "high" | "medium" | "low" };
  /** The real fixture we matched it to, when we found one. */
  match: { id: number; home: string; away: string; kickoffAt: string; league: string } | null;
  /** Set when the user should check this row before we act on it. */
  needsConfirmation: string | null;
};

export type ReadSlip = {
  bookmaker: string | null;
  bookingCode: string | null;
  totalOddsRead: number | null;
  totalOddsComputed: number | null;
  rows: ReadRow[];
  notes: string | null;
  /** True when every row matched a fixture and read clearly. */
  clean: boolean;
};

function toMatch(m: MatchSummary) {
  return { id: m.id, home: m.home.name, away: m.away.name, kickoffAt: m.kickoffAt, league: `${m.league.country} ${m.league.name}` };
}

/**
 * Reads an uploaded slip image/PDF and matches each row to a real fixture.
 * Nothing is booked here: the caller shows this back to the user to confirm first.
 */
export async function readSlipFile(opts: { user: AuthUser; file: UploadedFile; ipHash: string | null }): Promise<ReadSlip> {
  const { user, file, ipHash } = opts;
  await requireFeature(user.id, "upload");
  await enforceRateLimit({ userId: user.id, kind: "AI_CHAT", ...UPLOAD_LIMIT });

  const extracted: ExtractedSlip = await extractSlipFromFile(user, file, ipHash);

  const rows: ReadRow[] = await mapWithConcurrency(extracted.rows, 3, async (r, index) => {
    const read = { home: r.home, away: r.away, market: r.market, pick: r.pick, odds: r.odds, confidence: r.confidence };
    if (!r.home || !r.away) return { index, read, match: null, needsConfirmation: "We couldn't read both team names." };

    let match: ReadRow["match"] = null;
    try {
      const found = await searchMatches(r.home, r.away);
      if (found.length) match = toMatch(found[0]);
    } catch (err) {
      logger.info("read.match_lookup_failed", { err: err instanceof Error ? err.message : String(err) });
    }

    const needsConfirmation =
      match === null
        ? "We couldn't find this fixture in the next few days."
        : r.confidence !== "high"
          ? "This row was hard to read; check the teams and price."
          : r.odds === null
            ? "We couldn't read the price for this game."
            : null;
    return { index, read, match, needsConfirmation };
  });

  const prices = rows.map((r) => r.read.odds).filter((o): o is number => typeof o === "number");
  const computed = prices.length === rows.length && prices.length > 0 ? Math.round(prices.reduce((p, o) => p * o, 1) * 100) / 100 : null;

  return {
    bookmaker: extracted.bookmaker,
    bookingCode: extracted.booking_code,
    totalOddsRead: extracted.total_odds,
    totalOddsComputed: computed,
    rows,
    notes: extracted.notes,
    clean: rows.every((r) => r.needsConfirmation === null),
  };
}

/** Rejects files that are too large before they reach the model. */
export function assertUploadSize(bytes: number) {
  if (bytes > 4 * 1024 * 1024) throw new AppError("BAD_REQUEST", "That file is too big. Please upload something under 4 MB.");
}
