import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ghanaDate } from "@/lib/services/daily-picks";
import { readViaApi } from "@/lib/services/remote-data";
import { lookupMatch } from "@/lib/services/stats";
import { assess, DEFAULT_THRESHOLD, edge, quality, qualifies, type Threshold } from "@/lib/special-picks/assess";
import { fixtureAllowedOn } from "@/lib/special-picks/fixture-date";
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

/**
 * The public name of a slip.
 *
 * Derived from the date rather than random, so it is stable if a slip is ever rebuilt and so a
 * share link from a screenshot is still resolvable. Short enough to read aloud.
 */
export function slipReference(date: string): string {
  return `GC${date.slice(2).replace(/-/g, "")}`;
}

/** The research in a sentence, for the top of the slip and the share image. */
function summarise(picks: readonly Assessed[], total: number): string {
  const markets = [...new Set(picks.map((p) => marketLabel(p.candidate.market).toLowerCase()))];
  const sample = Math.min(...picks.map((p) => Number((p.evidence as { sample?: number }).sample ?? 0)));
  const list = markets.length === 1 ? markets[0] : `${markets.slice(0, -1).join(", ")} and ${markets.at(-1)}`;

  return (
    `${picks.length} selections at ${total.toFixed(2)}, on ${list}. ` +
    `Each one is drawn from at least ${sample} recent matches for the sides involved, and was ` +
    `priced above our own estimate of its chance at the time of publishing.`
  );
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
  // Research takes minutes, so the pre-publication check below needs a later clock than this one.
  // It is measured as elapsed time from here rather than read from `new Date()`, because `now` is
  // injected - by the tests, and by any future backfill - and a check that quietly consulted the
  // wall clock instead would reject every fixture whenever the two disagreed.
  const startedAt = Date.now();
  const sinceStart = () => new Date(now.getTime() + (Date.now() - startedAt));
  const skipped: string[] = [];

  // Idempotent by construction: the unique indexes make a duplicate publish impossible, and
  // checking first means a rerun is cheap rather than merely safe.
  const already = await db.specialSlip.count({ where: { forDate: new Date(date) } });
  if (already) return { date, published: 0, skipped: ["Today's slip is already published."] };

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

  // Only today's fixtures, and the filter is the guarantee rather than the window.
  //
  // The bookmaker is asked for 36 hours because a run has to see the whole of its own day whatever
  // time it happens at, but 36 hours from a Friday morning is mostly Saturday: measured here on
  // 2026-11-06, 50 of the 57 fixtures returned belonged to the next day. Nothing filtered them, so
  // Friday's slip went out carrying a Saturday lunchtime fixture. Narrowing the request would not
  // fix that - a window is a request, and a bookmaker is free to answer it loosely - so the date is
  // enforced here, on what came back.
  const verdicts = fixtures.map((f) => ({ f, verdict: fixtureAllowedOn(f.event, date, now) }));
  const onDate = verdicts.filter((x) => x.verdict.ok).map((x) => x.f);
  const rejected = new Map<string, number>();
  for (const { verdict } of verdicts) {
    if (!verdict.ok) rejected.set(verdict.reason, (rejected.get(verdict.reason) ?? 0) + 1);
  }
  if (rejected.size) {
    logger.info("special.fixtures_filtered", { date, kept: onDate.length, rejected: Object.fromEntries(rejected) });
  }
  if (!onDate.length) {
    return { date, published: 0, skipped: [`No fixture kicks off on ${date} with markets we price, so no slip was published.`] };
  }

  const candidates = dedupe(candidatesFrom(source.slug, onDate));
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
  if (!chosen.length) {
    return {
      date,
      published: 0,
      skipped: [
        `No combination of today's ${assessed.length} qualifying selections landed between ` +
          `${SPECIAL_BAND.min} and ${SPECIAL_BAND.max}, so no slip was published.`,
      ],
    };
  }

  // Checked again, against the clock as it is now rather than as it was when the fixtures were
  // listed. Research costs minutes and a provider can revise a kick-off in that time, so the state
  // this slip is published on is read immediately before it is written - not inherited from a list
  // that was true earlier.
  const atPublish = sinceStart();
  const stale = chosen
    .map((c) => ({ c, verdict: fixtureAllowedOn(c.candidate.event, date, atPublish) }))
    .filter((x) => !x.verdict.ok);
  if (stale.length) {
    logger.warn("special.stale_at_publish", {
      date,
      legs: stale.map((x) => `${x.c.candidate.event.home} v ${x.c.candidate.event.away}: ${(x.verdict as { reason: string }).reason}`),
    });
    return {
      date,
      published: 0,
      skipped: [`A selection stopped being valid for ${date} before it could be published, so no slip went out.`],
    };
  }

  const total = combinedOdds(chosen.map((c) => c.candidate.odds));

  // The slip first, then its legs. A leg with no slip is not a product, and the day's unique index
  // on the slip is what makes a concurrent rerun lose cleanly rather than publish a second one.
  let slip;
  try {
    slip = await db.specialSlip.create({
      data: {
        forDate: new Date(date),
        reference: slipReference(date),
        combinedOdds: total,
        target: SPECIAL_TARGET,
        summary: summarise(chosen, total),
        lastVerifiedAt: new Date(),
      },
    });
  } catch (err) {
    logger.info("special.slip_exists", { date, err: String(err) });
    return { date, published: 0, skipped: ["Today's slip is already published."] };
  }

  let published = 0;
  for (const [i, pick] of chosen.entries()) {
    const c = pick.candidate;
    try {
      await db.specialPick.create({
        data: {
          slipId: slip.id,
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

  logger.info("special.published", { date, published, combinedOdds: total, considered: assessed.length });
  return { date, published, skipped };
}

/**
 * What the day's slip has to be worth, and how close it has to get.
 *
 * Two odds, meaning the accumulator and not the legs. `IDEAL` is what the search aims at and
 * `BAND` is what it will accept when nothing lands on the nose - a slip at 1.93 built from strong
 * research is worth more than a contrived 2.00, and a slip at 2.60 is not the product that was
 * asked for however good its legs are.
 *
 * Nothing is ever added to reach the band. A combination that does not reach it is not published,
 * which is why the band has a floor as well as a ceiling.
 */
export const SPECIAL_TARGET = 2;
export const SPECIAL_IDEAL = { min: 1.99, max: 2.01 } as const;
export const SPECIAL_BAND = { min: 1.9, max: 2.1 } as const;

/** Legs on a slip. Two or three, never one, never four. */
export const SPECIAL_LEGS = { min: 2, max: 3 } as const;

/**
 * The day's slip: the combination whose odds land in the band with the best chance of coming in.
 *
 * Every combination of two and three candidates is considered, because the target is a property
 * of the combination and ranking legs independently is what published 1.08 and 1.23 as a day's
 * work. Within the band:
 *
 *   * different matches always - two lines on one game are nearly one bet, and a slip is only an
 *     accumulator if its legs can fail independently;
 *   * then the best combined chance, which is what actually distinguishes two ways of reaching
 *     2.00;
 *   * then landing inside the ideal 1.99-2.01 rather than merely inside the band;
 *   * then fewer legs, because every extra leg is another way to lose;
 *   * then a varied set of statistics, as a tie-break between equals.
 *
 * Returns an empty array when nothing qualifies, which is a normal day and not a failure.
 */
export function choose(assessed: readonly Assessed[]): Assessed[] {
  const ranked = [...assessed].sort((a, b) => b.rating - a.rating);

  type Combination = { picks: Assessed[]; total: number; probability: number; ideal: boolean; varied: number };
  let best: Combination | null = null;

  const better = (a: Combination, b: Combination | null) => {
    if (!b) return true;
    if (Math.abs(a.probability - b.probability) > 1e-9) return a.probability > b.probability;
    if (a.ideal !== b.ideal) return a.ideal;
    if (a.picks.length !== b.picks.length) return a.picks.length < b.picks.length;
    if (a.varied !== b.varied) return a.varied > b.varied;
    return Math.abs(a.total - SPECIAL_TARGET) < Math.abs(b.total - SPECIAL_TARGET) - 1e-9;
  };

  const consider = (picks: Assessed[]) => {
    const fixtures = new Set(picks.map((c) => c.candidate.event.externalId));
    if (fixtures.size !== picks.length) return;

    const total = picks.reduce((t, c) => t * c.candidate.odds, 1);
    if (total < SPECIAL_BAND.min - 1e-9 || total > SPECIAL_BAND.max + 1e-9) return;

    const combination: Combination = {
      picks,
      total,
      probability: picks.reduce((t, c) => t * c.probability, 1),
      ideal: total >= SPECIAL_IDEAL.min - 1e-9 && total <= SPECIAL_IDEAL.max + 1e-9,
      varied: new Set(picks.map((c) => c.candidate.market.kind)).size,
    };
    if (better(combination, best)) best = combination;
  };

  // Deliberately exhaustive over a shortlist that is already small - a day's qualifying candidates
  // number in the tens, and three nested loops over that is nothing next to one provider call.
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      consider([ranked[i], ranked[j]]);
      for (let k = j + 1; k < ranked.length; k++) consider([ranked[i], ranked[j], ranked[k]]);
    }
  }

  return best ? (best as Combination).picks : [];
}

/** The combined price of a set of legs, rounded the way it is stored and displayed. */
export function combinedOdds(odds: readonly number[]): number {
  return Math.round(odds.reduce((t, o) => t * o, 1) * 1000) / 1000;
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

export type SpecialPickDay = SpecialSlipView;

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

  const rows = await db.specialSlip.findMany({
    orderBy: { forDate: "desc" },
    take: days,
    include: { picks: { orderBy: { position: "asc" } } },
  });
  return rows.map(toSlipView);
}

type SlipRow = Awaited<ReturnType<typeof db.specialSlip.findMany<{ include: { picks: true } }>>>[number];

function toSlipView(row: SlipRow): SpecialSlipView {
  const legs = [...row.picks].sort((a, b) => a.position - b.position).map(toView);
  // The price now, as opposed to the price it was published at. Null the moment any leg stops
  // being priced, because a partial total would read as the slip's and be wrong.
  const latest = legs.map((l) => l.price.odds);
  const currentOdds = latest.every((o) => o !== null) ? combinedOdds(latest as number[]) : null;

  return {
    reference: row.reference,
    date: row.forDate.toISOString().slice(0, 10),
    combinedOdds: Number(row.combinedOdds),
    currentOdds,
    target: Number(row.target),
    summary: row.summary,
    status: row.status,
    publishedAt: row.publishedAt.toISOString(),
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    legs,
  };
}

/** One published slip by its public reference, for the share page. Null when there is no such slip. */
export async function specialSlipByReference(reference: string): Promise<SpecialSlipView | null> {
  const remote = await readViaApi<{ slip: SpecialSlipView | null }>(`/special-picks/${encodeURIComponent(reference)}`);
  if (remote) return remote.slip;

  const row = await db.specialSlip.findUnique({
    where: { reference },
    include: { picks: { orderBy: { position: "asc" } } },
  });
  return row ? toSlipView(row) : null;
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

export type SpecialSlipView = {
  /** Short, public, URL-safe: what a share link and a share image are keyed on. */
  reference: string;
  date: string;
  /** The price the slip was published at, from the legs' published prices. */
  combinedOdds: number;
  /** The combined price as it stands now, if every leg still prices. Null when a leg no longer does. */
  currentOdds: number | null;
  target: number;
  summary: string;
  status: SlipStatus;
  publishedAt: string;
  /** When the legs were last checked against the bookmaker. A morning price is not a price now. */
  lastVerifiedAt: string | null;
  legs: PublishedSpecialPick[];
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

export function slipFor(picks: readonly Settleable[], target = SPECIAL_TARGET): { combinedOdds: number | null; status: SlipStatus; target: number } {
  if (!picks.length) return { combinedOdds: null, status: "VOID", target };
  if (picks.some((p) => p.status === "PENDING")) return { combinedOdds: null, status: "PENDING", target };

  const live = picks.filter((p) => p.status !== "VOID");
  if (!live.length) return { combinedOdds: null, status: "VOID", target };

  const priced = live.every((p) => oddsOf(p) !== null);
  const combinedOdds = priced ? Math.round(live.reduce((t, p) => t * oddsOf(p)!, 1) * 1000) / 1000 : null;

  return { combinedOdds, status: live.every((p) => p.status === "WON") ? "WON" : "LOST", target };
}

/** Today's slip. Null on a day nothing was published, which is a normal day. */
export async function specialToday(date = ghanaDate()): Promise<SpecialSlipView | null> {
  if (date === ghanaDate()) {
    const remote = await readViaApi<{ today: SpecialSlipView | null }>("/special-picks");
    if (remote) return remote.today;
  }
  const row = await db.specialSlip.findUnique({
    where: { forDate: new Date(date) },
    include: { picks: { orderBy: { position: "asc" } } },
  });
  return row ? toSlipView(row) : null;
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

  // The slip is the bet, so the record counts slips. The legs are read alongside for the detail
  // underneath, because a slip hides which leg was wrong.
  const [slips, rows] = await Promise.all([
    db.specialSlip.findMany({ select: { status: true, combinedOdds: true, picks: { select: { status: true, odds: true } } } }),
    db.specialPick.findMany({ select: { status: true, marketKind: true } }),
  ]);

  let won = 0;
  let lost = 0;
  let voided = 0;
  let pending = 0;
  let profitUnits = 0;
  let stakedUnits = 0;
  let unpriced = 0;

  for (const slip of slips) {
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

    // Settled at the price the surviving legs were published at. A void leg drops out, so the
    // stored combined price is not always the one that pays.
    const live = slip.picks.filter((p) => p.status !== "VOID");
    const priced = live.length > 0 && live.every((p) => p.odds !== null);
    if (!priced) {
      unpriced++;
      continue;
    }
    stakedUnits += 1;
    profitUnits += slip.status === "WON" ? combinedOdds(live.map((p) => Number(p.odds))) - 1 : -1;
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
    total: slips.length,
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
