import "server-only";
import type { AuthUser } from "@/lib/auth";
import { getAdapter } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS, type BookmakerAdapter } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireFeature } from "@/lib/services/ai-quota";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import { BUILD_LIMIT } from "@/lib/services/build-slip";
import { buildFromFixtures, reasonFor, shortlistCandidates, toCandidates, type FixtureSlip } from "@/lib/slips/fixture-picks";
import { enrich, rankByEvidence, reasonWithEvidence, statsBlocked, withoutContradicted } from "@/lib/slips/enrich";

// "Make me a 5 odds for today": a slip built from a bookmaker's own live fixtures and prices,
// rather than from a slip the user already has, and booked so the user gets a real code to paste.
//
// Picks are booked by their raw market ids, because the varied markets this deliberately reaches
// for (corners, cards, fouls) have no internal market type. If the bookmaker cannot book, the picks
// are still returned with a note to add them by hand rather than failing the whole request.

export type Research = {
  /** Fixtures the bookmaker had prices for in the window. */
  fixturesScanned: number;
  /** Picks we looked up recent results for. */
  researched: number;
  /** Of those, how many had history covering that market. */
  withHistory: number;
  /** Picks the price liked but recent results argued against, so they were left out. */
  droppedOnStats: { game: string; pick: string; why: string }[];
  /** Set when recent form was unavailable to us, so the picks rest on prices alone. Say so. */
  formUnavailable: boolean;
};

export type TodaySlip = {
  bookmaker: { slug: string; name: string };
  /** The booking code at the bookmaker, or null when it couldn't be booked. */
  code: string | null;
  expiresAt: string | null;
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
  /** What was looked at to get here, so the user can judge the work rather than trust it. */
  research: Research;
};

/** The first bookmaker that can really list fixtures with prices. */
/** How many shortlisted picks we look up recent results for. Bounded: stats cost API requests. */
const STATS_BUDGET = 12;

const pickKey = (p: { event: { externalId: string }; raw: { marketId: string; outcomeId: string; specifier: string } }) =>
  `${p.event.externalId}|${p.raw.marketId}|${p.raw.outcomeId}|${p.raw.specifier}`;

export function priceSource(): BookmakerAdapter | null {
  return BOOKMAKER_SLUGS.map(getAdapter).find((a) => a.mode === "live" && a.capabilities.events) ?? null;
}

export async function buildFromToday(opts: {
  user: AuthUser;
  target: number;
  ipHash: string | null;
  /** How far ahead to look. A day by default: "today" to a bettor means today's card. */
  hours?: number;
  /** Only fixtures kicking off inside this window, for "tonight's games" or "morning games". */
  window?: { from: Date; to: Date };
}): Promise<TodaySlip> {
  const { user, target, ipHash, hours = 24, window } = opts;
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

  const inWindow = window
    ? fixtures.filter((f) => f.event.kickoffAt >= window.from && f.event.kickoffAt <= window.to)
    : fixtures;
  const candidates = toCandidates(inWindow);
  if (!candidates.length) {
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      window
        ? `${source.name} has no games in that time window we can build an honest slip from.`
        : `${source.name} has no games in the next ${hours} hours we can build an honest slip from.`,
    );
  }

  // Research the shortlist before choosing, so recent results can veto a pick the price liked —
  // rather than being written up afterwards to justify whatever the price picked.
  const pool = shortlistCandidates(candidates);
  const researched = await enrich(user, pool, STATS_BUDGET);
  const { kept, dropped } = withoutContradicted(researched);
  const ranked = rankByEvidence(kept);

  const slip = buildFromFixtures(ranked.length ? ranked : pool, target, {
    bookmakerName: source.name,
    preShortlisted: true,
  });
  if (!slip) throw new AppError("BAD_REQUEST", "We couldn't build a slip from today's games.");

  // Carry each chosen pick's research back onto it.
  const byKey = new Map(researched.map((p) => [pickKey(p), p]));
  const reasons = slip.picks.map((p) => {
    const found = byKey.get(pickKey(p));
    return reasonWithEvidence({ ...p, evidence: found?.evidence ?? null, gap: found?.gap ?? "none" }, reasonFor(p, source.name));
  });

  const research: Research = {
    fixturesScanned: inWindow.length,
    researched: Math.min(pool.length, STATS_BUDGET),
    withHistory: researched.filter((p) => p.evidence).length,
    droppedOnStats: dropped.map((p) => ({
      game: `${p.event.home} v ${p.event.away}`,
      pick: p.label,
      why: p.evidence!.text,
    })),
    formUnavailable: statsBlocked(researched),
  };

  // Book it, so the user gets a code rather than a list to retype. A booking failure must not lose
  // the picks: they are real either way, so fall back to "add these yourself".
  let code: string | null = null;
  let expiresAt: Date | null = null;
  if (source.capabilities.createCode) {
    try {
      const created = await source.createCode(
        slip.picks.map((p) => ({ eventExternalId: p.event.externalId, raw: p.raw })),
      );
      code = created.code;
      expiresAt = created.expiresAt;
    } catch (error) {
      logger.warn("today.booking_failed", { bookmaker: source.slug, error: String(error) });
    }
  }

  await logUsage({
    userId: user.id,
    ipHash,
    kind: "SLIP_EDIT",
    success: true,
    meta: { op: "today", target, reached: slip.reachedTarget, games: slip.picks.length, bookmaker: source.slug, booked: code !== null },
  });

  return {
    bookmaker: { slug: source.slug, name: source.name },
    code,
    expiresAt: expiresAt?.toISOString() ?? null,
    target,
    reachedTarget: slip.reachedTarget,
    totalOdds: slip.totalOdds,
    chance: slip.chance,
    confidence: slip.confidence,
    research,
    picks: slip.picks.map((p, i) => ({
      position: p.position,
      home: p.event.home,
      away: p.event.away,
      competition: p.event.competition,
      kickoffAt: p.event.kickoffAt.toISOString(),
      marketLabel: p.marketLabel,
      pickLabel: p.label,
      odds: p.odds,
      probability: p.probability,
      reason: reasons[i],
    })),
    bookable: code !== null,
    bookingNote: code
      ? `Booked on ${source.name}. Paste code ${code} into their app.`
      : `We couldn't get a ${source.name} booking code for this one, so add these picks on ${source.name} yourself. Every price above is ${source.name}'s own.`,
  };
}
