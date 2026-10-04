import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { logger } from "@/lib/logger";
import { evidenceFor, NO_EVIDENCE, type Evidence } from "@/lib/stats/evidence";
import { getMatchDetail, lookupMatch } from "@/lib/services/stats";
import type { PickCandidate } from "@/lib/slips/fixture-picks";

// Attaches real recent-results evidence to picks, and lets stats veto a pick the price liked.
//
// Stats cost API requests, so this is deliberately bounded: we enrich a shortlist, not the whole
// card. Anything that fails or isn't covered simply has no evidence, and the pick stands on the
// bookmaker's price — stated as such, never dressed up.

export type EnrichedPick = PickCandidate & {
  evidence: Evidence | null;
  /** The stats provider's fixture id, when we matched one. Needed to settle the pick later. */
  statsFixtureId: number | null;
  /** Why there is no evidence, so "we found nothing" is never confused with "we couldn't look". */
  gap: "none" | "market-not-covered" | "fixture-not-found" | "no-history" | "stats-plan" | "error";
};

export type ResearchNotes = {
  /** Fixtures the bookmaker offered that we could build from at all. */
  considered: number;
  /** Fixtures we looked up recent results for. */
  researched: number;
  /** Of those, how many had history covering the pick's market. */
  withEvidence: number;
};

/** Below this, recent results actively disagree with the price and the pick is dropped. */
export const CONTRADICTION = 0.4;
/** Thin samples can't veto anything. */
const MIN_SAMPLE = 6;

type Looked = { evidence: Evidence | null; gap: EnrichedPick["gap"]; statsFixtureId: number | null };

async function evidenceForPick(user: AuthUser | null, pick: PickCandidate): Promise<Looked> {
  const match = await lookupMatch(pick.event.home, pick.event.away, pick.event.kickoffAt, pick.event.competition);
  if (!match) return { evidence: null, gap: "fixture-not-found", statsFixtureId: null };
  // Only what the evidence reads. The build that asked for this research is the metered action.
  const detail = await getMatchDetail(user, match.id, match.kickoffAt.slice(0, 10), { sections: ["form", "h2h"], meter: false });

  const evidence = evidenceFor(
    { marketId: pick.raw.marketId, outcome: pick.market?.outcome ?? pick.raw.outcomeId, line: pick.market?.line ?? null },
    detail,
  );
  if (evidence) return { evidence, gap: "none", statsFixtureId: match.id };

  // Distinguish "our stats plan can't fetch form" from "this market has no comparable history".
  const noForm = detail.unavailable.includes("form") || !detail.form.home.matches.length;
  return { evidence: null, gap: noForm ? "stats-plan" : "market-not-covered", statsFixtureId: match.id };
}

/**
 * How many picks are researched at once. Eight, not more: measured against the real provider,
 * sixteen at a time was consistently slower than eight, because the limit is the provider's, not
 * ours. Widening it only queues up against its per-minute cap.
 */
const RESEARCH_CONCURRENCY = 8;

/**
 * Looks up recent results for up to `limit` picks, keeping the order given. Failures are swallowed:
 * a stats outage must never stop someone getting a slip.
 */
export async function enrich(user: AuthUser | null, picks: PickCandidate[], limit: number): Promise<EnrichedPick[]> {
  const head = picks.slice(0, limit);
  const enriched = await mapWithConcurrency(head, RESEARCH_CONCURRENCY, async (pick): Promise<EnrichedPick> => {
    try {
      return { ...pick, ...(await evidenceForPick(user, pick)) };
    } catch (error) {
      const planLimited = /plan/i.test(String(error));
      if (!planLimited) logger.warn("enrich.stats_failed", { home: pick.event.home, away: pick.event.away, error: String(error) });
      return { ...pick, evidence: null, gap: planLimited ? "stats-plan" : "error", statsFixtureId: null };
    }
  });
  return [...enriched, ...picks.slice(limit).map((p) => ({ ...p, evidence: null, gap: "none" as const, statsFixtureId: null }))];
}

/**
 * Drops picks whose recent results clearly argue against them, keeping the rest in order. A pick
 * with no evidence is kept: absence of history is not evidence against.
 */
export function withoutContradicted(picks: EnrichedPick[]): { kept: EnrichedPick[]; dropped: EnrichedPick[] } {
  const kept: EnrichedPick[] = [];
  const dropped: EnrichedPick[] = [];
  for (const p of picks) {
    const bad = p.evidence && p.evidence.sample >= MIN_SAMPLE && p.evidence.support < CONTRADICTION;
    (bad ? dropped : kept).push(p);
  }
  return { kept, dropped };
}

/** Identifies one pick, for carrying research across rebuilds. */
export const pickKey = (p: { event: { externalId: string }; raw: { marketId: string; outcomeId: string; specifier: string } }) =>
  `${p.event.externalId}|${p.raw.marketId}|${p.raw.outcomeId}|${p.raw.specifier}`;

/** Strongest first: recent results break ties the bookmaker's price leaves level. */
export function rankByEvidence(picks: EnrichedPick[]): EnrichedPick[] {
  const score = (p: EnrichedPick) => (p.evidence ? p.probability * 0.6 + p.evidence.support * 0.4 : p.probability * 0.6);
  return [...picks].sort((a, b) => score(b) - score(a));
}

/** The published reason: what the results say, then the price. Falls back honestly. */
export function reasonWithEvidence(pick: EnrichedPick, priceReason: string): string {
  if (pick.evidence) return `${pick.evidence.text} ${priceReason}`;
  if (pick.gap === "stats-plan") return `${priceReason} We couldn't pull recent form for this game, so it rests on the price alone.`;
  return `${priceReason} ${NO_EVIDENCE}`;
}

/** True when nothing could be researched because the stats plan blocked it, not because we didn't try. */
export function statsBlocked(picks: EnrichedPick[]): boolean {
  const looked = picks.filter((p) => p.gap !== "none" || p.evidence);
  return looked.length > 0 && looked.every((p) => p.gap === "stats-plan");
}
