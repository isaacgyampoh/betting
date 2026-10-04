import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { PickStatus } from "@/lib/generated/prisma/enums";
import { getActiveSubscription } from "@/lib/services/profile";
import { buildFromFixtures, hasEvidenceSupport, reasonFor, shortlistCandidates, toCandidates } from "@/lib/slips/fixture-picks";
import { enrich, pickKey, rankByEvidence, reasonWithEvidence, withoutContradicted } from "@/lib/slips/enrich";
import { canSettleFromScore } from "@/lib/services/slip-results";

// Daily picks are generated once per day for everyone (not per user) to keep AI cost flat, and
// published unchanged. Results are filled in automatically after kickoff; rows are never edited
// or removed, so the public record includes every loss.

export const DAILY_TARGETS = [2, 5] as const;

/** How many picks the daily research covers. Larger than a user's build: it runs once for everyone. */
const DAILY_SHORTLIST = 18;


export type DailyPickLegView = {
  position: number;
  home: string;
  away: string;
  competition: string | null;
  kickoffAt: string;
  marketLabel: string;
  pickLabel: string;
  odds: number;
  reason: string;
  status: PickStatus;
  resultText: string | null;
};

export type DailyPickView = {
  id: string;
  forDate: string;
  target: number;
  totalOdds: number;
  confidence: string;
  chance: string;
  status: PickStatus;
  legs: DailyPickLegView[];
  /** False when the viewer's plan doesn't include picks: legs are hidden. */
  unlocked: boolean;
};

/** Today in Ghana (GMT), as YYYY-MM-DD. */
export function ghanaDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function chanceInWords(probability: number): string {
  if (probability <= 0) return "very unlikely";
  const oneIn = Math.round(1 / probability);
  return oneIn <= 1 ? "very likely" : `roughly a 1 in ${oneIn} chance`;
}

/** Picks are visible to plans whose row has allowDailyPicks set. */
export async function canSeePicks(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const sub = await getActiveSubscription(userId);
  return sub?.plan.allowDailyPicks === true;
}

function toView(
  pick: { id: string; forDate: Date; target: number; totalOdds: unknown; probability: unknown; confidence: string; status: PickStatus; legs: unknown[] },
  unlocked: boolean,
): DailyPickView {
  const legs = pick.legs as {
    position: number;
    homeTeam: string;
    awayTeam: string;
    competition: string | null;
    kickoffAt: Date;
    marketLabel: string;
    pickLabel: string;
    odds: unknown;
    reason: string;
    status: PickStatus;
    resultText: string | null;
  }[];
  return {
    id: pick.id,
    forDate: pick.forDate.toISOString().slice(0, 10),
    target: pick.target,
    totalOdds: Number(pick.totalOdds),
    confidence: pick.confidence,
    chance: chanceInWords(Number(pick.probability)),
    status: pick.status,
    unlocked,
    legs: unlocked
      ? legs.map((l) => ({
          position: l.position,
          home: l.homeTeam,
          away: l.awayTeam,
          competition: l.competition,
          kickoffAt: l.kickoffAt.toISOString(),
          marketLabel: l.marketLabel,
          pickLabel: l.pickLabel,
          odds: Number(l.odds),
          reason: l.reason,
          status: l.status,
          resultText: l.resultText,
        }))
      : [],
  };
}

const pickInclude = { legs: { orderBy: { position: "asc" as const } } };

/** Today's published picks. Legs are hidden unless the viewer's plan includes them. */
export async function getTodaysPicks(userId: string | null): Promise<DailyPickView[]> {
  const unlocked = await canSeePicks(userId);
  const picks = await db.dailyPick.findMany({
    where: { forDate: new Date(ghanaDate()) },
    include: pickInclude,
    orderBy: { target: "asc" },
  });
  return picks.map((p) => toView(p, unlocked));
}

export type TrackRecord = {
  total: number;
  won: number;
  lost: number;
  pending: number;
  winRate: number | null;
  /** Return on investment across settled picks, as a percentage of stakes. */
  roi: number | null;
  byTarget: { target: number; total: number; won: number; winRate: number | null; roi: number | null }[];
  picks: DailyPickView[];
};

/**
 * Every daily pick ever published, with results. Public and unfiltered: losses are always included.
 * ROI assumes one unit staked per pick.
 *
 * A pick's games are shown once it has settled, which is what makes the record checkable. Today's
 * still-running picks show their header but not their legs — those are the thing people pay for,
 * and publishing them here handed the paid feature away for nothing. Nothing is hidden permanently:
 * every pick opens up the moment it settles, and none is ever edited or removed.
 */
export async function getTrackRecord(limit = 60): Promise<TrackRecord> {
  const picks = await db.dailyPick.findMany({ include: pickInclude, orderBy: { forDate: "desc" }, take: limit });
  const settled = picks.filter((p) => p.status === "WON" || p.status === "LOST");
  const won = settled.filter((p) => p.status === "WON");

  const roiOf = (rows: typeof settled) => {
    if (!rows.length) return null;
    const returned = rows.filter((p) => p.status === "WON").reduce((sum, p) => sum + Number(p.totalOdds), 0);
    return Math.round(((returned - rows.length) / rows.length) * 1000) / 10;
  };
  const rateOf = (rows: typeof settled) => (rows.length ? Math.round((rows.filter((p) => p.status === "WON").length / rows.length) * 1000) / 10 : null);

  return {
    total: picks.length,
    won: won.length,
    lost: settled.length - won.length,
    pending: picks.filter((p) => p.status === "PENDING").length,
    winRate: rateOf(settled),
    roi: roiOf(settled),
    byTarget: DAILY_TARGETS.map((target) => {
      const rows = settled.filter((p) => p.target === target);
      return { target, total: rows.length, won: rows.filter((p) => p.status === "WON").length, winRate: rateOf(rows), roi: roiOf(rows) };
    }),
    // Settled picks are fully open to everyone; a pick still running keeps its games until it is.
    picks: picks.map((p) => toView(p, p.status !== "PENDING")),
  };
}

export type GenerationResult = { date: string; created: number; skipped: string[] };

/**
 * Generates today's picks from real fixtures and real prices. Returns what it skipped and why,
 * rather than inventing anything: with no bookmaker connected to live odds, nothing is published.
 *
 * Published picks are never regenerated. The record has to stay checkable, so a pick that exists
 * for a date and target is left exactly as it was.
 */
export async function generateDailyPicks(now = new Date()): Promise<GenerationResult> {
  const date = ghanaDate(now);
  const skipped: string[] = [];
  let created = 0;

  // Only a bookmaker that can really list fixtures and prices can source a pick.
  const source = BOOKMAKER_SLUGS.map(getAdapter).find((a) => a.mode === "live" && a.capabilities.events);
  if (!source) {
    logger.warn("daily.no_live_prices", { date });
    return {
      date,
      created: 0,
      skipped: ["No bookmaker is connected to live prices, so no picks were generated. We never publish made-up odds."],
    };
  }

  const targets: number[] = [];
  for (const target of DAILY_TARGETS) {
    const existing = await db.dailyPick.findUnique({ where: { forDate_target: { forDate: new Date(date), target } } });
    if (existing) skipped.push(`${target} odds: already published today`);
    else targets.push(target);
  }
  if (!targets.length) return { date, created: 0, skipped };

  // One fetch of today's fixtures with prices, shared by every target.
  const { listUpcomingWithOffers } = await import("@/lib/bookmakers/live/sportybet");
  const fixtures = await listUpcomingWithOffers({ hours: 24, pages: 3 }).catch((error: unknown) => {
    logger.error("daily.fixtures_failed", { date, error: String(error) });
    return [];
  });
  // Only picks a final score can decide. The record says every published pick ends up won or lost,
  // and a corners line or a first-half total can never be either - it would sit at "still running"
  // for ever, quietly keeping the slip it is on off the record with it. A user's own slip may hold
  // any market; it just gets told to check that one at the bookmaker.
  const candidates = toCandidates(fixtures).filter((c) => canSettleFromScore(c.market));
  if (!candidates.length) {
    logger.warn("daily.no_candidates", { date, fixtures: fixtures.length });
    return { date, created: 0, skipped: [...skipped, "No fixture today had prices we could build an honest pick from."] };
  }

  // Published picks are judged in public, so they get the same research a user's slip does: recent
  // results are looked up over the shortlist and may veto a pick the price liked. This runs once a
  // day for everyone, so the stats cost is flat. There is no user here, hence the null.
  // Markets we hold history for first, so published picks carry real evidence (see build-from-today).
  const evidenced = candidates.filter((c) => hasEvidenceSupport(c.group));
  // Three of a market in the pool, two in the published slip: these are the picks the public record
  // is judged on, and the research cost here is flat - once a day, for everyone.
  const pool = shortlistCandidates(evidenced.length ? evidenced : candidates, DAILY_SHORTLIST, { perGroup: 3 });
  const researched = await enrich(null, pool, DAILY_SHORTLIST).catch((error: unknown) => {
    logger.warn("daily.research_failed", { date, error: String(error) });
    return pool.map((p) => ({ ...p, evidence: null, gap: "error" as const, statsFixtureId: null }));
  });
  const { kept, dropped } = withoutContradicted(researched);
  if (dropped.length) logger.info("daily.dropped_on_form", { date, dropped: dropped.length });
  const ranked = rankByEvidence(kept);
  const evidenceByKey = new Map(researched.map((p) => [pickKey(p), p]));
  // A vetoed pick must not return through the wider fallback search below.
  const vetoed = new Set(dropped.map(pickKey));
  const widerPool = candidates.filter((c) => !vetoed.has(pickKey(c)));

  for (const target of targets) {
    let slip = ranked.length ? buildFromFixtures(ranked, target, { bookmakerName: source.name, preShortlisted: true }) : null;
    if (!slip?.reachedTarget) {
      const wider = buildFromFixtures(widerPool, target, { bookmakerName: source.name });
      if (wider && (!slip || wider.reachedTarget)) slip = wider;
    }
    if (!slip || !slip.reachedTarget) {
      skipped.push(`${target} odds: today's prices couldn't reach ${target} without reaching for games we don't rate.`);
      continue;
    }
    await db.dailyPick.create({
      data: {
        forDate: new Date(date),
        target,
        totalOdds: slip.totalOdds,
        probability: Number(slip.probability.toFixed(4)),
        confidence: slip.confidence,
        legs: {
          create: slip.picks.map((p) => ({
            position: p.position,
            homeTeam: p.event.home,
            awayTeam: p.event.away,
            competition: p.event.competition,
            kickoffAt: p.event.kickoffAt,
            marketLabel: p.marketLabel,
            pickLabel: p.label,
            odds: p.odds,
            // Stored so the pick can be settled from a final score, and checked against the record.
            market: p.market ?? undefined,
            apiFootballFixtureId: evidenceByKey.get(pickKey(p))?.statsFixtureId ?? null,
            reason: (() => {
              const found = evidenceByKey.get(pickKey(p));
              return reasonWithEvidence(
                { ...p, evidence: found?.evidence ?? null, gap: found?.gap ?? "none", statsFixtureId: null },
                reasonFor(p, source.name),
              );
            })(),
          })),
        },
      },
    });
    created++;
    logger.info("daily.published", { date, target, totalOdds: slip.totalOdds, legs: slip.picks.length });
  }
  return { date, created, skipped };
}

/** Fills in results for picks whose games have finished. Never changes a settled pick. */
export async function settleDailyPicks(
  resultFor: (leg: {
    apiFootballFixtureId: number | null;
    homeTeam: string;
    awayTeam: string;
    kickoffAt: Date;
    competition: string | null;
    market: unknown;
  }) => Promise<{ status: PickStatus; resultText: string } | null>,
): Promise<{ settled: number }> {
  // Oldest first, so a backlog drains in the order it built up rather than whichever way the
  // database happened to return it.
  const open = await db.dailyPick.findMany({ where: { status: "PENDING" }, include: pickInclude, orderBy: { forDate: "asc" } });
  let settled = 0;

  for (const pick of open) {
    let changed = false;
    for (const leg of pick.legs) {
      if (leg.status !== "PENDING") continue;
      const result = await resultFor(leg).catch((err) => {
        logger.warn("daily.settle_lookup_failed", { legId: leg.id, err });
        return null;
      });
      if (!result) continue;
      await db.dailyPickLeg.update({ where: { id: leg.id }, data: { status: result.status, resultText: result.resultText } });
      changed = true;
    }
    if (!changed) continue;

    const legs = await db.dailyPickLeg.findMany({ where: { pickId: pick.id } });
    // One lost leg loses the accumulator, whatever the others do. Waiting for every leg to resolve
    // first left slips pending for ever: a slip with a loser and one leg the score cannot decide -
    // a corners or cards line - would never settle, so a published loss never reached the record.
    // The record this product is judged on was filling up with "still running" instead of losses.
    if (legs.some((l) => l.status === "LOST")) {
      await db.dailyPick.update({ where: { id: pick.id }, data: { status: "LOST", settledAt: new Date() } });
      settled++;
      logger.info("daily.settled", { pickId: pick.id, target: pick.target, status: "LOST", decided: "a leg lost" });
      continue;
    }
    // A win needs every leg in: one unresolved leg could still lose it.
    if (legs.some((l) => l.status === "PENDING")) continue;
    const status: PickStatus = legs.every((l) => l.status === "VOID") ? "VOID" : "WON";
    await db.dailyPick.update({ where: { id: pick.id }, data: { status, settledAt: new Date() } });
    settled++;
    logger.info("daily.settled", { pickId: pick.id, target: pick.target, status });
  }
  return { settled };
}

export function assertPicksUnlocked(unlocked: boolean) {
  if (!unlocked) throw new AppError("PLAN_LIMIT_REACHED", "Daily picks are part of the Weekly and Monthly plans.");
}
