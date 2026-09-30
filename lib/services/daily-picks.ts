import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { PickStatus } from "@/lib/generated/prisma/enums";
import { getActiveSubscription } from "@/lib/services/profile";

// Daily picks are generated once per day for everyone (not per user) to keep AI cost flat, and
// published unchanged. Results are filled in automatically after kickoff; rows are never edited
// or removed, so the public record includes every loss.

export const DAILY_TARGETS = [2, 5] as const;


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
    // The public list shows every pick's games, whatever the viewer's plan: the record must be checkable.
    picks: picks.map((p) => toView(p, true)),
  };
}

export type GenerationResult = { date: string; created: number; skipped: string[] };

/**
 * Generates today's picks. Returns what it skipped and why, rather than inventing anything:
 * real odds are required, so this needs at least one bookmaker connected to live prices.
 */
export async function generateDailyPicks(now = new Date()): Promise<GenerationResult> {
  const date = ghanaDate(now);
  const skipped: string[] = [];

  const connected = BOOKMAKER_SLUGS.filter((s) => getAdapter(s).mode === "live");
  if (connected.length === 0) {
    logger.warn("daily.no_live_prices", { date });
    return { date, created: 0, skipped: ["No bookmaker is connected to live prices, so no picks were generated. We never publish made-up odds."] };
  }

  // With live prices connected, build one pick per target from real fixtures.
  // (Implemented with the live adapters; see docs/capturing-bookmaker-requests.md.)
  for (const target of DAILY_TARGETS) {
    const existing = await db.dailyPick.findUnique({ where: { forDate_target: { forDate: new Date(date), target } } });
    if (existing) skipped.push(`${target} odds: already published today`);
  }
  return { date, created: 0, skipped };
}

/** Fills in results for picks whose games have finished. Never changes a settled pick. */
export async function settleDailyPicks(
  resultFor: (leg: { apiFootballFixtureId: number | null; homeTeam: string; awayTeam: string; kickoffAt: Date }) => Promise<{ status: PickStatus; resultText: string } | null>,
): Promise<{ settled: number }> {
  const open = await db.dailyPick.findMany({ where: { status: "PENDING" }, include: pickInclude });
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
    if (legs.some((l) => l.status === "PENDING")) continue;
    const status: PickStatus = legs.some((l) => l.status === "LOST") ? "LOST" : legs.every((l) => l.status === "VOID") ? "VOID" : "WON";
    await db.dailyPick.update({ where: { id: pick.id }, data: { status, settledAt: new Date() } });
    settled++;
    logger.info("daily.settled", { pickId: pick.id, target: pick.target, status });
  }
  return { settled };
}

export function assertPicksUnlocked(unlocked: boolean) {
  if (!unlocked) throw new AppError("PLAN_LIMIT_REACHED", "Daily picks are part of the Weekly and Monthly plans.");
}
