import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ghanaDate } from "@/lib/services/daily-picks";
import { readViaApi } from "@/lib/services/remote-data";
import { lookupMatch } from "@/lib/services/stats";
import { assess, DEFAULT_THRESHOLD, edge, quality, qualifies, type Threshold } from "@/lib/special-picks/assess";
import { candidatesFrom, dedupe, type SpecialCandidate } from "@/lib/special-picks/candidates";
import { marketLabel } from "@/lib/special-picks/markets";
import { coverage, describeEvidence, MIN_COVERAGE, research } from "@/lib/special-picks/research";

/**
 * Daily Special Picks: up to two researched selections a day, in specialist statistical markets.
 *
 * Separate from `daily-picks.ts` on purpose. That builds an accumulator to reach a total-odds
 * target and settles it from the final score; this publishes single selections settled from match
 * statistics. They share the bookmaker adapters, the stats provider and the cron, not the table.
 *
 * The order of operations is the feature's main safeguard. It starts from a bookmaker's priced
 * offers, matches each fixture to the stats provider, researches only a budgeted shortlist, and
 * publishes only what clears every gate. Publishing nothing is a normal outcome and the thresholds
 * are set expecting it.
 */

/**
 * How many fixtures may be researched in one run.
 *
 * Each costs roughly eighteen provider calls, against a free allowance of 1,000 a day of which the
 * Live Centre already spends about 770. Ten fixtures is ~180 calls on a cold cache and far less
 * afterwards, since a team's sample is cached for twelve hours and the same team recurs. Raising
 * this without raising the provider plan is how the scoreboard goes down at teatime.
 */
const RESEARCH_BUDGET_FIXTURES = 10;

/**
 * Where the prices come from, named rather than inferred.
 *
 * Both are the Hopegaming platform, so they list the same markets under the same raw names and the
 * same `listUpcomingWithOffers`. Only these two: the market vocabulary in `markets.ts` was measured
 * against them, and a price read from one bookmaker must never be published under another's name.
 *
 * That is the mistake this replaces. It used to take the first live adapter the registry offered
 * and then read offers from SportyBet regardless, so a day when SportyBet was not the first live
 * adapter would have published SportyBet's prices labelled as somebody else's.
 */
const PRICE_SOURCES = [
  { slug: "sportybet", load: () => import("@/lib/bookmakers/live/sportybet") },
  { slug: "footballcom", load: () => import("@/lib/bookmakers/live/footballcom") },
] as const;

async function priceSource() {
  const { getAdapter } = await import("@/lib/bookmakers/registry");
  for (const candidate of PRICE_SOURCES) {
    const adapter = getAdapter(candidate.slug);
    if (adapter.mode !== "live" || !adapter.capabilities.events) continue;
    const { listUpcomingWithOffers } = await candidate.load();
    return { slug: candidate.slug, listUpcomingWithOffers };
  }
  return null;
}

export type SpecialResult = {
  date: string;
  published: number;
  /** Why nothing, or why only one - shown in the empty state rather than swallowed. */
  skipped: string[];
};

type Assessed = {
  candidate: SpecialCandidate;
  statsFixtureId: number;
  rating: number;
  confidence: string;
  probability: number;
  reason: string;
  evidence: Record<string, unknown>;
};

export async function generateSpecialPicks(now = new Date(), threshold: Threshold = DEFAULT_THRESHOLD): Promise<SpecialResult> {
  const date = ghanaDate(now);
  const skipped: string[] = [];

  // Idempotent by construction: the unique indexes make a duplicate publish impossible, and
  // checking first means a rerun is cheap rather than merely safe.
  const already = await db.specialPick.count({ where: { forDate: new Date(date) } });
  if (already >= 2) return { date, published: 0, skipped: ["Today's selections are already published."] };

  const source = await priceSource();
  if (!source) {
    logger.warn("special.no_live_bookmaker", { date });
    return { date, published: 0, skipped: ["No bookmaker is connected to live prices, so no odds could be verified."] };
  }

  // Prices first. A selection with no verified market and price is not a selection.
  const fixtures = await source.listUpcomingWithOffers({ hours: 36, pages: 3 }).catch((err: unknown) => {
    logger.error("special.offers_failed", { date, bookmaker: source.slug, err: String(err) });
    return [];
  });

  const candidates = dedupe(candidatesFrom(source.slug, fixtures));
  if (!candidates.length) {
    return { date, published: 0, skipped: ["No specialist market was priced for today's fixtures."] };
  }

  // Research is budgeted by fixture, not by candidate: every market on one fixture reads the same
  // two team histories, so a fixture is the unit that costs money.
  const byFixture = new Map<string, SpecialCandidate[]>();
  for (const c of candidates) {
    const list = byFixture.get(c.event.externalId) ?? [];
    list.push(c);
    byFixture.set(c.event.externalId, list);
  }
  const shortlist = [...byFixture.entries()]
    .sort((a, b) => a[1][0].event.kickoffAt.getTime() - b[1][0].event.kickoffAt.getTime())
    .slice(0, RESEARCH_BUDGET_FIXTURES);

  const assessed: Assessed[] = [];

  for (const [, group] of shortlist) {
    const ev = group[0].event;

    // The fixture has to be found at the stats provider, or there is nothing to research it with
    // and nothing to settle it from later.
    const match = await lookupMatch(ev.home, ev.away, ev.kickoffAt, ev.competition ?? undefined).catch(() => null);
    if (!match) {
      logger.info("special.fixture_unmatched", { home: ev.home, away: ev.away });
      continue;
    }

    for (const candidate of group) {
      const r = await research(candidate.market, match.home.id, match.away.id).catch((err: unknown) => {
        logger.warn("special.research_failed", { home: ev.home, err: String(err) });
        return null;
      });
      if (!r) continue;

      // A statistic the competition does not reliably carry is not evidence.
      if (coverage(r) < MIN_COVERAGE) continue;

      const a = assess(r.observations, candidate.line, candidate.outcome);
      if (!a) continue;

      const value = edge(a.probability, candidate.odds);
      const q = quality(a, value);
      if (!qualifies(a, q, value, threshold)) continue;

      assessed.push({
        candidate,
        statsFixtureId: match.id,
        rating: q.rating,
        confidence: q.confidence,
        probability: a.probability,
        reason: describeEvidence(r, candidate.line, candidate.outcome, candidate.market.side),
        evidence: {
          sample: a.sample,
          hitRate: Number(a.hitRate.toFixed(3)),
          mean: Number(a.mean.toFixed(2)),
          spread: Number(a.spread.toFixed(2)),
          margin: Number(a.margin.toFixed(2)),
          coverage: Number(coverage(r).toFixed(2)),
          incomplete: r.incomplete,
          sources: r.sources,
          values: r.observations.map((o) => o.value),
        },
      });
    }
  }

  if (!assessed.length) {
    return { date, published: 0, skipped: ["No selection passed the research threshold today."] };
  }

  const chosen = choose(assessed);
  if (chosen.length < 2) skipped.push("Only one selection met the threshold today, so only one was published.");

  let published = 0;
  for (const [i, pick] of chosen.entries()) {
    const c = pick.candidate;
    try {
      await db.specialPick.create({
        data: {
          forDate: new Date(date),
          position: i + 1,
          statsFixtureId: pick.statsFixtureId,
          homeTeam: c.event.home,
          awayTeam: c.event.away,
          competition: c.event.competition,
          country: c.event.country,
          kickoffAt: c.event.kickoffAt,
          marketKind: c.market.kind,
          marketSide: c.market.side,
          marketPeriod: c.market.period,
          line: c.line,
          outcome: c.outcome,
          bookmaker: c.bookmaker,
          rawMarketName: c.rawMarketName,
          odds: c.odds,
          oddsCheckedAt: new Date(),
          probability: pick.probability,
          confidence: pick.confidence,
          rating: pick.rating,
          reason: pick.reason,
          evidence: pick.evidence as never,
          researchedAt: new Date(),
          oddsHistory: { create: { bookmaker: c.bookmaker, odds: c.odds, line: c.line } },
        },
      });
      published++;
    } catch (err) {
      // The unique indexes are the real guard against a duplicate; a clash here means a concurrent
      // run got there first, which is a success for the system even though this attempt failed.
      logger.info("special.duplicate_skipped", { date, position: i + 1, err: String(err) });
    }
  }

  logger.info("special.published", { date, published, considered: assessed.length });
  return { date, published, skipped };
}

/**
 * What the day's selections have to be worth together.
 *
 * Two odds, which in this codebase already means a definite thing: `buildTargetSlip` requires a
 * slip to *reach* its target and then prefers the combination that gets there with the best chance,
 * breaking ties by landing closest. Special picks follow the same rule so that "2 odds" means the
 * same on both pages.
 *
 * This replaces ranking the two selections independently, which is how the first four days
 * published 1.08 and 1.23 - each defensible alone, and together worth 1.33 for a day's research.
 */
export const SPECIAL_TARGET = 2;

/**
 * The day's selections, as a pair that reaches the target.
 *
 * The two are chosen as one slip rather than as the two best singles, because the target is a
 * property of the pair. From the pairs that reach it:
 *
 *   * different matches always - two lines on one game are nearly the same bet, and the brief
 *     forbids filling the quota with correlated outcomes;
 *   * then the best combined chance, because reaching 2.00 is the requirement and the chance of
 *     actually getting there is what distinguishes one way of doing it from another;
 *   * then a different statistic where that is a free choice between equals;
 *   * then closest to the target, so the slip is not padded with price for its own sake.
 *
 * Nothing is manufactured to reach two. A single selection is published when it reaches the target
 * on its own and no pair does; otherwise nothing is, which is a normal day.
 */
export function choose(assessed: readonly Assessed[], target = SPECIAL_TARGET): Assessed[] {
  const ranked = [...assessed].sort((a, b) => b.rating - a.rating);

  type Pair = { picks: Assessed[]; total: number; probability: number; varied: boolean };
  let best: Pair | null = null;

  // Chance first, then variety, then closeness. Variety is a preference and the combined chance is
  // the slip's actual quality, so a genuinely likelier pair is not passed over to put two different
  // statistics on the page - the correlation rule that matters is "different matches", and that is
  // a hard filter above.
  const better = (a: Pair, b: Pair | null) => {
    if (!b) return true;
    if (Math.abs(a.probability - b.probability) > 1e-9) return a.probability > b.probability;
    if (a.varied !== b.varied) return a.varied;
    return a.total < b.total - 1e-9;
  };

  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const [x, y] = [ranked[i], ranked[j]];
      if (x.candidate.event.externalId === y.candidate.event.externalId) continue;

      const total = x.candidate.odds * y.candidate.odds;
      if (total < target - 1e-9) continue;

      const pair: Pair = {
        picks: [x, y],
        total,
        probability: x.probability * y.probability,
        varied: x.candidate.market.kind !== y.candidate.market.kind,
      };
      if (better(pair, best)) best = pair;
    }
  }
  if (best) return best.picks;

  // No pair reaches it. One selection can, if it is long enough by itself.
  const single = ranked.filter((c) => c.candidate.odds >= target - 1e-9);
  return single.length ? [single[0]] : [];
}

export type PublishedSpecialPick = {
  position: number;
  match: { home: string; away: string; competition: string | null; country: string | null; kickoffAt: string };
  market: { kind: string; side: string; label: string; line: number; outcome: "OVER" | "UNDER" };
  price: { bookmaker: string | null; odds: number | null; checkedAt: string | null };
  /** Our own estimate. Never a price, and labelled as an estimate wherever it is shown. */
  probability: number;
  confidence: string;
  reason: string;
  evidence: Record<string, unknown>;
  researchedAt: string;
  status: "PENDING" | "WON" | "LOST" | "VOID";
  actual: number | null;
};

/**
 * Today's published selections, in the order they were published. At most two.
 *
 * On the Worker this reads through the API, because only Render can reach the database - see
 * `remote-data.ts`. Only for today: the endpoint publishes today's selections and nothing else,
 * so any other date has to come from Postgres or not at all.
 */
export async function listSpecialPicks(date = ghanaDate()): Promise<PublishedSpecialPick[]> {
  if (date === ghanaDate()) {
    const remote = await readViaApi<{ picks: PublishedSpecialPick[] }>("/special-picks");
    if (remote) return remote.picks;
  }
  const rows = await db.specialPick.findMany({
    where: { forDate: new Date(date) },
    orderBy: { position: "asc" },
  });
  return rows.map(toView);
}

export type SpecialPickDay = { date: string; slip: SpecialSlip; picks: PublishedSpecialPick[] };

/**
 * Every day that has been published, newest first.
 *
 * The public record. Nothing is filtered: a day with one selection appears with one, a loss
 * appears as a loss, and a day where nothing qualified simply has no row to show - which is
 * visible as a gap in the dates rather than hidden by renumbering.
 */
export async function listSpecialHistory(days = 60): Promise<SpecialPickDay[]> {
  const remote = await readViaApi<{ history: SpecialPickDay[] }>("/special-picks?history=1");
  if (remote?.history) return remote.history;

  const rows = await db.specialPick.findMany({
    orderBy: [{ forDate: "desc" }, { position: "asc" }],
    // Two a day, so this is `days` days of history with room for a day that published once.
    take: days * 2,
  });

  const byDate = new Map<string, PublishedSpecialPick[]>();
  for (const r of rows) {
    const key = r.forDate.toISOString().slice(0, 10);
    const list = byDate.get(key) ?? [];
    list.push(toView(r));
    byDate.set(key, list);
  }
  return [...byDate.entries()].map(([date, picks]) => ({ date, slip: slipFor(picks), picks }));
}

type SpecialPickRow = Awaited<ReturnType<typeof db.specialPick.findMany>>[number];

function toView(r: SpecialPickRow): PublishedSpecialPick {
  return {
    position: r.position,
    match: {
      home: r.homeTeam,
      away: r.awayTeam,
      competition: r.competition,
      country: r.country,
      kickoffAt: r.kickoffAt.toISOString(),
    },
    market: {
      kind: r.marketKind,
      side: r.marketSide,
      label: marketLabel({ kind: r.marketKind as never, side: r.marketSide as never, period: r.marketPeriod as never }),
      line: Number(r.line),
      outcome: r.outcome as "OVER" | "UNDER",
    },
    price: {
      bookmaker: r.bookmaker,
      odds: r.odds === null ? null : Number(r.odds),
      checkedAt: r.oddsCheckedAt?.toISOString() ?? null,
    },
    probability: Number(r.probability),
    confidence: r.confidence,
    reason: r.reason,
    evidence: r.evidence as Record<string, unknown>,
    researchedAt: r.researchedAt.toISOString(),
    status: r.status,
    actual: r.actual === null ? null : Number(r.actual),
  };
}

/** How a day's selections settle, once they are treated as one slip. */
export type SlipStatus = "PENDING" | "WON" | "LOST" | "VOID";

export type SpecialSlip = {
  /** Null while any leg is unsettled, or when a leg was published without a price. */
  combinedOdds: number | null;
  status: SlipStatus;
  /** What the target was on the day, so an old slip is not judged against a newer rule. */
  target: number;
};

/**
 * One day's selections as a slip.
 *
 * The rules are a bookmaker's, not ours to invent: a void leg drops out at odds 1.00 rather than
 * sinking the slip, every remaining leg has to win, and the day is still running while any leg is.
 * A day whose legs all voided is void. A leg published without a price leaves the slip unpriceable
 * - it still wins or loses, it just cannot be scored in units.
 */
type Settleable = { status: string; odds?: unknown; price?: { odds: number | null } };

const oddsOf = (p: Settleable): number | null => {
  const raw = p.price ? p.price.odds : p.odds;
  return raw === null || raw === undefined ? null : Number(raw);
};

export function slipFor(picks: readonly Settleable[], target = SPECIAL_TARGET): SpecialSlip {
  if (!picks.length) return { combinedOdds: null, status: "VOID", target };
  if (picks.some((p) => p.status === "PENDING")) return { combinedOdds: null, status: "PENDING", target };

  const live = picks.filter((p) => p.status !== "VOID");
  if (!live.length) return { combinedOdds: null, status: "VOID", target };

  const priced = live.every((p) => oddsOf(p) !== null);
  const combinedOdds = priced ? Math.round(live.reduce((t, p) => t * oddsOf(p)!, 1) * 1000) / 1000 : null;

  return { combinedOdds, status: live.every((p) => p.status === "WON") ? "WON" : "LOST", target };
}

/** Today's selections as the slip they are. Null on a day nothing was published. */
export async function specialToday(date = ghanaDate()): Promise<SpecialPickDay | null> {
  const picks = await listSpecialPicks(date);
  return picks.length ? { date, slip: slipFor(picks), picks } : null;
}

export type SpecialPerformance = {
  /** Days published. A day is one slip, and a slip is the thing that wins or loses. */
  total: number;
  won: number;
  lost: number;
  void: number;
  pending: number;
  /** Settled days only, and settled means won or lost - a void is neither. */
  winRate: number | null;
  /**
   * Profit in units, one unit staked on each day's slip, at the prices published.
   *
   * A win returns (combined odds - 1), a loss costs 1, a void returns nothing and costs nothing.
   * A day with a leg published without a price cannot be scored in units and is reported as
   * `unpriced` rather than silently dropped - excluding it from the denominator would be the same
   * flattering arithmetic the brief warns about.
   */
  profitUnits: number;
  stakedUnits: number;
  unpriced: number;
  /**
   * The individual selections underneath, because a slip hides which half was wrong.
   *
   * A day can lose with one leg winning, and a record that only ever reported slips would never
   * say so.
   */
  legs: { total: number; won: number; lost: number; void: number; pending: number };
  byMarket: { kind: string; total: number; won: number; lost: number; winRate: number | null }[];
};

/**
 * The published record, computed from what was actually published.
 *
 * Nothing is excluded to improve it. Losses count, voids are reported as voids rather than quietly
 * removed, and the win rate is over settled selections only - which is stated, because a win rate
 * over everything including pending would drift as the day went on.
 */
export async function specialPerformance(): Promise<SpecialPerformance> {
  const remote = await readViaApi<{ performance: SpecialPerformance }>("/special-picks");
  if (remote?.performance) return remote.performance;

  const rows = await db.specialPick.findMany({
    select: { forDate: true, status: true, odds: true, marketKind: true },
  });

  // Grouped by day, because the day is the bet. Two selections published together are one slip
  // staked once, so counting them as two independent wins would describe a product nobody has.
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.forDate.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }

  let won = 0;
  let lost = 0;
  let voided = 0;
  let pending = 0;
  let profitUnits = 0;
  let stakedUnits = 0;
  let unpriced = 0;

  for (const picks of byDay.values()) {
    const slip = slipFor(picks);
    if (slip.status === "PENDING") {
      pending++;
      continue;
    }
    if (slip.status === "VOID") {
      voided++;
      continue;
    }
    if (slip.status === "WON") won++;
    else lost++;

    if (slip.combinedOdds === null) {
      unpriced++;
      continue;
    }
    stakedUnits += 1;
    profitUnits += slip.status === "WON" ? slip.combinedOdds - 1 : -1;
  }

  const settled = won + lost;
  const legCount = (s: string) => rows.filter((r) => r.status === s).length;

  const kinds = [...new Set(rows.map((r) => r.marketKind))].sort();
  const byMarket = kinds.map((kind) => {
    const mine = rows.filter((r) => r.marketKind === kind);
    const w = mine.filter((r) => r.status === "WON").length;
    const l = mine.filter((r) => r.status === "LOST").length;
    return { kind, total: mine.length, won: w, lost: l, winRate: w + l > 0 ? w / (w + l) : null };
  });

  return {
    total: byDay.size,
    won,
    lost,
    void: voided,
    pending,
    winRate: settled > 0 ? won / settled : null,
    profitUnits: Math.round(profitUnits * 100) / 100,
    stakedUnits,
    unpriced,
    legs: {
      total: rows.length,
      won: legCount("WON"),
      lost: legCount("LOST"),
      void: legCount("VOID"),
      pending: legCount("PENDING"),
    },
    byMarket,
  };
}
