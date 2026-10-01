import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { BookmakerSlug } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildTargetSlip, chanceInWords, confidenceOf, type Candidate, type Confidence } from "@/lib/slips/target-odds";
import type { SlipView } from "@/lib/slips/view";
import { asBookmakerError, getOwnedSlipRecord, marketOf, saveSlip, toSlipView, withLogos, type DraftSelection } from "@/lib/services/slips";
import { lookupMatch, getMatchDetail } from "@/lib/services/stats";
import { requireFeature } from "@/lib/services/ai-quota";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import type { MatchDetail } from "@/lib/stats/types";
import type { RawMarket } from "@/lib/bookmakers/types";

export const BUILD_LIMIT = { limit: 30, windowMs: 60 * 60_000 };

export type BuiltSlip = {
  slip: SlipView;
  target: number;
  reachedTarget: boolean;
  confidence: Confidence;
  chance: string;
  /** One or two plain sentences per pick, in slip order. */
  reasons: { position: number; text: string }[];
  /** Games left out of the new slip, and why. */
  dropped: { home: string; away: string; reason: string }[];
};

/**
 * What the stats say about one side winning / not losing, as a probability plus a short reason.
 * Returns undefined when we hold nothing useful, so the price stands on its own.
 */
function statsView(d: MatchDetail, homeTeam: string, outcome: string | null): { probability: number; reason: string } | undefined {
  const side = outcome === "HOME" || outcome === "HOME_DRAW" ? "home" : outcome === "AWAY" || outcome === "DRAW_AWAY" ? "away" : null;
  if (!side) return undefined;
  const form = d.form[side];
  const played = form.summary.played;
  if (!played) return undefined;

  const wins = form.summary.won;
  const draws = form.summary.drawn;
  const covers = outcome === "HOME_DRAW" || outcome === "DRAW_AWAY" ? wins + draws : wins;
  const probability = covers / played;
  const name = form.team.name;
  const record = `${wins}W ${draws}D ${form.summary.lost}L in their last ${played}`;

  // Head-to-head adds context when the same fixture has met before.
  let h2h = "";
  if (d.h2h.length) {
    const sideWins = d.h2h.filter((m) => {
      const isHome = m.home.name === homeTeam;
      const g = isHome ? m.goals : { home: m.goals.away, away: m.goals.home };
      return side === "home" ? (g.home ?? 0) > (g.away ?? 0) : (g.away ?? 0) > (g.home ?? 0);
    }).length;
    h2h = ` They've won ${sideWins} of the last ${d.h2h.length} meetings.`;
  }
  return { probability, reason: `${name} are ${record}.${h2h}` };
}

/** Candidates from a slip the user already has: real prices, with stats attached where we have them. */
async function candidatesFromSlip(user: AuthUser, slipId: string) {
  const source = await getOwnedSlipRecord(user, slipId);
  const now = new Date();
  const usable = source.selections.filter((s) => s.status === "OK" && marketOf(s) && s.bookmakerEvent && s.kickoffAt > now && s.odds !== null);
  const dropped = source.selections
    .filter((s) => !usable.includes(s))
    .map((s) => ({
      home: s.homeTeam,
      away: s.awayTeam,
      reason: s.kickoffAt <= now ? "already started" : s.status !== "OK" ? "not available on this bookmaker" : "market not supported",
    }));

  const candidates: Candidate[] = await mapWithConcurrency(usable, 3, async (s) => {
    const base: Candidate = { position: s.position, odds: Number(s.odds) };
    try {
      const match = await lookupMatch(s.homeTeam, s.awayTeam, s.kickoffAt, s.competition);
      if (!match) return base;
      const detail = await getMatchDetail(user, match.id, match.kickoffAt.slice(0, 10));
      const view = statsView(detail, s.homeTeam, s.outcome);
      return view ? { ...base, statProbability: view.probability, statReason: view.reason } : base;
    } catch (err) {
      logger.info("build.stats_skipped", { position: s.position, err: err instanceof Error ? err.message : String(err) });
      return base;
    }
  });
  return { source, usable, candidates, dropped };
}

/**
 * Builds a slip from an existing slip that reaches a target total odds, choosing the combination
 * with the best estimated chance, and books it on the same bookmaker.
 */
export async function buildToTarget(opts: {
  user: AuthUser;
  slipId: string;
  target: number;
  ipHash: string | null;
  maxPicks?: number;
}): Promise<BuiltSlip> {
  const { user, target, ipHash } = opts;
  if (!(target > 1)) throw new AppError("BAD_REQUEST", "Give a target total odds above 1.0.");
  await requireFeature(user.id, "build");
  await enforceRateLimit({ userId: user.id, kind: "SLIP_EDIT", ...BUILD_LIMIT });

  const { source, usable, candidates, dropped } = await candidatesFromSlip(user, opts.slipId);
  if (!candidates.length) throw new AppError("BAD_REQUEST", "This slip has no games that can still be booked.");

  const chosen = buildTargetSlip(candidates, target, { maxPicks: opts.maxPicks });
  if (!chosen) throw new AppError("BAD_REQUEST", "We couldn't build a slip from these games.");

  const byPosition = new Map(usable.map((s) => [s.position, s]));
  const picks = chosen.positions.map((p) => byPosition.get(p)!);
  const adapter = getAdapter(source.bookmaker.slug as BookmakerSlug);
  const created = await adapter
    .createCode(picks.map((s) => ({ eventExternalId: s.bookmakerEvent!.externalId, market: marketOf(s)! })))
    .catch((err) => {
      throw asBookmakerError(err, adapter.slug, "createCode");
    });

  const drafts: DraftSelection[] = picks.map((s, i) => ({
    position: i + 1,
    event: { externalId: s.bookmakerEvent!.externalId, home: s.homeTeam, away: s.awayTeam, kickoffAt: s.kickoffAt, competition: s.competition },
    market: marketOf(s),
    odds: s.odds === null ? null : Number(s.odds),
    raw: (s.raw as RawMarket | null) ?? null,
    status: "OK",
  }));
  const saved = await saveSlip({
    userId: user.id,
    bookmakerId: source.bookmaker.id,
    kind: "EDITED",
    code: created.code,
    parentSlipId: source.id,
    expiresAt: created.expiresAt,
    selections: drafts,
  });

  const reasons = chosen.picks.map((p, i) => {
    const s = byPosition.get(p.position)!;
    const price = `Priced at ${Number(s.odds).toFixed(2)}, about a ${Math.round(p.probability * 100)}% chance on our estimate.`;
    return { position: i + 1, text: p.statReason ? `${p.statReason} ${price}` : `${price} We have no recent form for this game, so this rests on the price alone.` };
  });

  await logUsage({
    userId: user.id,
    ipHash,
    kind: "SLIP_EDIT",
    success: true,
    meta: { op: "target", target, reached: chosen.reachedTarget, games: picks.length, sourceSlipId: source.id },
  });

  return {
    slip: await withLogos(toSlipView(saved)),
    target,
    reachedTarget: chosen.reachedTarget,
    confidence: confidenceOf(chosen.probability),
    chance: chanceInWords(chosen.probability),
    reasons,
    dropped,
  };
}
