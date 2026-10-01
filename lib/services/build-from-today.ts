import "server-only";
import type { AuthUser } from "@/lib/auth";
import { getAdapter } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS, type BookmakerAdapter } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireFeature } from "@/lib/services/ai-quota";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import { BUILD_LIMIT } from "@/lib/services/build-slip";
import {
  buildFromFixtures,
  classifyFixture,
  hasEvidenceSupport,
  reasonFor,
  shortlistCandidates,
  toCandidates,
  type FixtureKind,
  type FixtureSlip,
  type PickCandidate,
} from "@/lib/slips/fixture-picks";
import { enrich, pickKey, rankByEvidence, reasonWithEvidence, statsBlocked, withoutContradicted } from "@/lib/slips/enrich";

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
  /** Fixtures skipped for what they are, e.g. friendlies, with how many of each. */
  skipped: { kind: FixtureKind; count: number }[];
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
  /** Kinds of fixture to leave out. Friendlies are dropped unless this says otherwise. */
  exclude?: FixtureKind[];
}): Promise<TodaySlip> {
  const { user, target, ipHash, hours = 24, window, exclude = ["friendly"] } = opts;
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
  const candidates = toCandidates(inWindow, { exclude });
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
  //
  // Markets we hold history for come first. Filling a slip with corner and card lines would make the
  // research pointless: every leg would read "no history for this market". Corners and cards are
  // only reached for when the evidenced markets cannot get to the target on their own.
  const evidenced = candidates.filter((c) => hasEvidenceSupport(c.group));
  const pool = shortlistCandidates(evidenced.length ? evidenced : candidates);
  const researched = await enrich(user, pool, STATS_BUDGET);
  const { kept, dropped } = withoutContradicted(researched);
  const ranked = rankByEvidence(kept);

  const build = (from: PickCandidate[], preShortlisted: boolean) =>
    buildFromFixtures(from, target, { bookmakerName: source.name, preShortlisted });

  // A pick recent results argued against must stay out, including when we widen the search. Letting
  // one back in would publish it alongside the very evidence against it.
  const vetoed = new Set(dropped.map(pickKey));

  let slip = ranked.length ? build(ranked, true) : null;
  if (!slip?.reachedTarget) {
    // Widen to every market, including the ones no stats speak to, rather than miss the target.
    const wider = build(candidates.filter((c) => !vetoed.has(pickKey(c))), false);
    if (wider && (!slip || wider.reachedTarget)) slip = wider;
  }
  if (!slip) throw new AppError("BAD_REQUEST", "We couldn't build a slip from today's games.");

  // Carry each chosen pick's research back onto it.
  const byKey = new Map(researched.map((p) => [pickKey(p), p]));
  // Nothing recent results argued against may reach the user.
  if (slip.picks.some((p) => vetoed.has(pickKey(p)))) {
    logger.error("today.vetoed_pick_leaked", { picks: slip.picks.filter((p) => vetoed.has(pickKey(p))).map((p) => p.label) });
    throw new AppError("BAD_REQUEST", "We couldn't build a slip we'd stand behind from today's games.");
  }
  const reasons = slip.picks.map((p) => {
    const found = byKey.get(pickKey(p));
    return reasonWithEvidence(
      { ...p, evidence: found?.evidence ?? null, gap: found?.gap ?? "none", statsFixtureId: null },
      reasonFor(p, source.name),
    );
  });

  const skippedCounts = new Map<FixtureKind, number>();
  for (const f of inWindow) {
    const kind = classifyFixture(f.event);
    if (exclude.includes(kind)) skippedCounts.set(kind, (skippedCounts.get(kind) ?? 0) + 1);
  }

  const research: Research = {
    fixturesScanned: inWindow.length,
    skipped: [...skippedCounts].map(([kind, count]) => ({ kind, count })),
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
