import "server-only";
import type { AuthUser } from "@/lib/auth";
import { getAdapter } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS, type BookmakerAdapter } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireFeature } from "@/lib/services/ai-quota";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import { BUILD_LIMIT } from "@/lib/services/build-slip";
import { buildFromFixtures, toCandidates, type FixtureSlip } from "@/lib/slips/fixture-picks";

// "Make me a 5 odds for today": a slip built from a bookmaker's own live fixtures and prices,
// rather than from a slip the user already has.
//
// Nothing here is booked. Creating a booking code is a POST we have not captured for any
// bookmaker, so the result says plainly that it cannot be booked yet instead of offering a button
// that would fail. The picks themselves are real and the user can place them by hand.

export type TodaySlip = {
  bookmaker: { slug: string; name: string };
  target: number;
  reachedTarget: boolean;
  totalOdds: number;
  chance: string;
  confidence: FixtureSlip["confidence"];
  picks: {
    position: number;
    home: string;
    away: string;
    competition: string | null;
    kickoffAt: string;
    marketLabel: string;
    pickLabel: string;
    odds: number;
    /** The bookmaker's own probability for this outcome, 0..1. Never modelled by us. */
    probability: number;
    reason: string;
  }[];
  /** Whether we can turn this into a booking code at the bookmaker yet. */
  bookable: boolean;
  bookingNote: string;
};

/** The first bookmaker that can really list fixtures with prices. */
export function priceSource(): BookmakerAdapter | null {
  return BOOKMAKER_SLUGS.map(getAdapter).find((a) => a.mode === "live" && a.capabilities.events) ?? null;
}

export async function buildFromToday(opts: {
  user: AuthUser;
  target: number;
  ipHash: string | null;
  /** How far ahead to look. A day by default: "today" to a bettor means today's card. */
  hours?: number;
}): Promise<TodaySlip> {
  const { user, target, ipHash, hours = 24 } = opts;
  if (!(target > 1)) throw new AppError("BAD_REQUEST", "Give a target total odds above 1.0.");

  const source = priceSource();
  if (!source) {
    throw new AppError(
      "BOOKMAKER_NOT_CONNECTED",
      "No bookmaker is connected to live prices yet, so we can't price a slip from scratch. Paste a booking code and we'll build from that instead.",
    );
  }

  await requireFeature(user.id, "build");
  await enforceRateLimit({ userId: user.id, kind: "SLIP_EDIT", ...BUILD_LIMIT });

  // Only SportyBet exposes a bulk fixtures-with-prices endpoint today; when a second bookmaker is
  // connected this should move behind a capability on the adapter.
  const { listUpcomingWithOffers } = await import("@/lib/bookmakers/live/sportybet");
  const fixtures = await listUpcomingWithOffers({ hours, pages: 3 }).catch((error: unknown) => {
    logger.error("today.fixtures_failed", { error: String(error) });
    throw new AppError("BOOKMAKER_UNAVAILABLE", `We couldn't read ${source.name}'s fixtures just now. Please try again in a moment.`);
  });

  const candidates = toCandidates(fixtures);
  if (!candidates.length) {
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      `${source.name} has no games in the next ${hours} hours we can build an honest slip from.`,
    );
  }

  const slip = buildFromFixtures(candidates, target, { bookmakerName: source.name });
  if (!slip) throw new AppError("BAD_REQUEST", "We couldn't build a slip from today's games.");

  await logUsage({
    userId: user.id,
    ipHash,
    kind: "SLIP_EDIT",
    success: true,
    meta: { op: "today", target, reached: slip.reachedTarget, games: slip.picks.length, bookmaker: source.slug },
  });

  return {
    bookmaker: { slug: source.slug, name: source.name },
    target,
    reachedTarget: slip.reachedTarget,
    totalOdds: slip.totalOdds,
    chance: slip.chance,
    confidence: slip.confidence,
    picks: slip.picks.map((p) => ({
      position: p.position,
      home: p.event.home,
      away: p.event.away,
      competition: p.event.competition,
      kickoffAt: p.event.kickoffAt.toISOString(),
      marketLabel: p.marketLabel,
      pickLabel: p.label,
      odds: p.odds,
      probability: p.probability,
      reason: p.reason,
    })),
    bookable: source.capabilities.createCode,
    bookingNote: source.capabilities.createCode
      ? `We can book this on ${source.name}.`
      : `We can't create a ${source.name} booking code yet, so add these picks on ${source.name} yourself. Every price above is ${source.name}'s own.`,
  };
}
