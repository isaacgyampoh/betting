import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/identity/admin";
import { logger } from "@/lib/logger";
import { candidatesFrom, dedupe } from "@/lib/special-picks/candidates";
import { accraDate, fixtureAllowedOn } from "@/lib/special-picks/fixture-date";
import {
  bySeverity,
  expectedValue,
  legFindings,
  slipFindings,
  worst,
  type Finding,
  type Severity,
} from "@/lib/special-picks/integrity";
import { rollUpSlip } from "@/lib/services/settle-special";
import { SPECIAL_BAND, SPECIAL_LEGS, priceSource } from "@/lib/services/special-picks";

/**
 * The Slip Desk: what the daily slip pipeline actually did, and the one safe way to intervene.
 *
 * Three principles hold throughout, and they are the reason this is a service rather than a few
 * queries in a page.
 *
 * **Nothing published is ever rewritten.** Not a price, not the evidence, not the reason, not a
 * result. `SpecialPick.odds` is the price the slip went out at and the record is only worth
 * reading if it still says so tomorrow. The single intervention offered here is to *void* an open
 * selection, which is a state settlement already produces on its own, and the audit row keeps who
 * did it and why.
 *
 * **Judgements are computed, never stored.** Every warning on this page is derived from the row
 * each time it is read. A stored verdict is a verdict that goes stale the moment the rule behind
 * it is improved, and the rules here are young.
 *
 * **Absences are reported as loudly as faults.** The costliest bug in this pipeline was a job that
 * could never match a row: for weeks it did nothing, successfully. Nothing failed, so nothing
 * showed. `pipelineStatus` exists to make a job that has never done anything impossible to miss.
 */

const SHAPE = { band: SPECIAL_BAND, legs: SPECIAL_LEGS };

const num = (d: unknown): number => Number(d as never);
const maybe = (d: unknown): number | null => (d === null || d === undefined ? null : Number(d as never));

export type DeskLeg = {
  id: string;
  position: number;
  home: string;
  away: string;
  competition: string | null;
  kickoffAt: Date;
  /** The Accra day this leg actually kicks off on, which is not always the slip's. */
  kickoffDay: string;
  market: string;
  line: number;
  outcome: string;
  bookmaker: string | null;
  odds: number | null;
  probability: number;
  rating: number;
  confidence: string;
  sample: number;
  reason: string;
  status: string;
  actual: number | null;
  /** Expected return per unit staked at the published price. Null when there was no price. */
  ev: number | null;
  latestOdds: number | null;
  latestOddsAt: Date | null;
  findings: Finding[];
  severity: Severity | null;
};

export type Desk = {
  date: string;
  slip: {
    id: string;
    reference: string;
    combinedOdds: number;
    target: number;
    summary: string;
    status: string;
    publishedAt: Date;
    lastVerifiedAt: Date | null;
    settledAt: Date | null;
  } | null;
  legs: DeskLeg[];
  slipFindings: Finding[];
  severity: Severity | null;
  /** Every finding on the day, slip-level and leg-level, worst first. */
  all: Finding[];
};

/**
 * One day's slip, with every number the generator decided on and every fault it left behind.
 *
 * The expected value of each leg is computed here and shown unconditionally, not only when it is
 * bad. A figure that appears only when something is wrong teaches nobody what normal looks like.
 */
export async function slipDesk(date: string, now = new Date()): Promise<Desk> {
  const slip = await db.specialSlip.findUnique({
    where: { forDate: new Date(date) },
    select: {
      id: true,
      reference: true,
      combinedOdds: true,
      target: true,
      summary: true,
      status: true,
      publishedAt: true,
      lastVerifiedAt: true,
      settledAt: true,
    },
  });

  // Legs are read by date rather than through the slip, so the rows published before slips
  // existed - which carry no slipId - are still inspectable here.
  const picks = await db.specialPick.findMany({
    where: { forDate: new Date(date) },
    orderBy: { position: "asc" },
    include: { oddsHistory: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });

  const legs: DeskLeg[] = picks.map((p) => {
    const odds = maybe(p.odds);
    const probability = num(p.probability);
    const latest = p.oddsHistory[0] ?? null;
    const latestOdds = latest ? num(latest.odds) : null;
    const evidence = (p.evidence ?? {}) as { sample?: number };
    const review = {
      position: p.position,
      kickoffAt: p.kickoffAt,
      status: p.status as DeskLeg["status"] as never,
      odds,
      probability,
      sample: Number(evidence.sample ?? 0),
      latestOdds,
      latestOddsAt: latest?.checkedAt ?? null,
    };
    const findings = bySeverity(legFindings(review, date, now));
    return {
      id: p.id,
      position: p.position,
      home: p.homeTeam,
      away: p.awayTeam,
      competition: p.competition,
      kickoffAt: p.kickoffAt,
      kickoffDay: accraDate(p.kickoffAt),
      // Side before kind, so it reads "match shots on target" rather than "shots on target match".
      market: `${p.marketSide} ${p.marketKind}`.toLowerCase().replace(/_/g, " "),
      line: num(p.line),
      outcome: p.outcome,
      bookmaker: p.bookmaker,
      odds,
      probability,
      rating: num(p.rating),
      confidence: p.confidence,
      sample: Number(evidence.sample ?? 0),
      reason: p.reason,
      status: p.status,
      actual: maybe(p.actual),
      ev: expectedValue(probability, odds),
      latestOdds,
      latestOddsAt: latest?.checkedAt ?? null,
      findings,
      severity: worst(findings),
    };
  });

  const sf = slip
    ? bySeverity(
        slipFindings(
          {
            forDate: date,
            combinedOdds: num(slip.combinedOdds),
            status: slip.status as never,
            publishedAt: slip.publishedAt,
            lastVerifiedAt: slip.lastVerifiedAt,
            legs: legs.map((l) => ({
              position: l.position,
              kickoffAt: l.kickoffAt,
              status: l.status as never,
              odds: l.odds,
              probability: l.probability,
              sample: l.sample,
              latestOdds: l.latestOdds,
              latestOddsAt: l.latestOddsAt,
            })),
          },
          now,
          SHAPE,
        ),
      )
    : [];

  const all = bySeverity([...sf, ...legs.flatMap((l) => l.findings)]);

  return {
    date,
    slip: slip
      ? {
          id: slip.id,
          reference: slip.reference,
          combinedOdds: num(slip.combinedOdds),
          target: num(slip.target),
          summary: slip.summary,
          status: slip.status,
          publishedAt: slip.publishedAt,
          lastVerifiedAt: slip.lastVerifiedAt,
          settledAt: slip.settledAt,
        }
      : null,
    legs,
    slipFindings: sf,
    severity: worst(all),
    all,
  };
}

export type DeskRow = {
  date: string;
  reference: string | null;
  combinedOdds: number | null;
  status: string;
  legs: number;
  bad: number;
  warn: number;
};

/**
 * The last `limit` days, with a count of what is wrong on each.
 *
 * Deliberately a day list rather than a slip list: a day with no slip is itself a fact worth
 * seeing, and it is the shape "no qualifying selections means no slip" is supposed to produce.
 */
export async function recentDays(limit = 14, now = new Date()): Promise<DeskRow[]> {
  const days: string[] = [];
  for (let i = 0; i < limit; i++) days.push(accraDate(new Date(now.getTime() - i * 86_400_000)));

  const [slips, picks] = await Promise.all([
    db.specialSlip.findMany({
      where: { forDate: { in: days.map((d) => new Date(d)) } },
      select: { forDate: true, reference: true, combinedOdds: true, status: true },
    }),
    db.specialPick.findMany({
      where: { forDate: { in: days.map((d) => new Date(d)) } },
      include: { oddsHistory: { orderBy: { checkedAt: "desc" }, take: 1 } },
    }),
  ]);

  const slipBy = new Map(slips.map((s) => [accraDate(s.forDate), s]));
  return days.map((date) => {
    const mine = picks.filter((p) => accraDate(p.forDate) === date);
    const findings = mine.flatMap((p) => {
      const latest = p.oddsHistory[0] ?? null;
      const evidence = (p.evidence ?? {}) as { sample?: number };
      return legFindings(
        {
          position: p.position,
          kickoffAt: p.kickoffAt,
          status: p.status as never,
          odds: maybe(p.odds),
          probability: num(p.probability),
          sample: Number(evidence.sample ?? 0),
          latestOdds: latest ? num(latest.odds) : null,
          latestOddsAt: latest?.checkedAt ?? null,
        },
        date,
        now,
      );
    });
    const s = slipBy.get(date);
    return {
      date,
      reference: s?.reference ?? null,
      combinedOdds: s ? num(s.combinedOdds) : null,
      status: s?.status ?? (mine.length ? "UNSLIPPED" : "NONE"),
      legs: mine.length,
      bad: findings.filter((f) => f.severity === "bad").length,
      warn: findings.filter((f) => f.severity === "warn").length,
    };
  });
}

/**
 * Voids one open selection, with a reason that is kept.
 *
 * Only a PENDING leg. A graded one is refused outright: a published win or loss is the record, and
 * a dashboard that can quietly turn a loss into a void is a dashboard that can flatter the win
 * rate. If a leg was graded wrongly, that is a settlement bug to fix in settlement, where the
 * correction is visible in a diff rather than in one person's click.
 *
 * Voiding the last open leg completes the slip, through the same rollup the nightly job uses.
 */
export async function voidSpecialPick(actorId: string, pickId: string, reason: string, now = new Date()) {
  const trimmed = reason.trim();
  if (trimmed.length < 4) throw new AppError("BAD_REQUEST", "Give a reason; it is kept with the record.");

  const pick = await db.specialPick.findUnique({
    where: { id: pickId },
    select: { id: true, slipId: true, position: true, status: true, forDate: true, homeTeam: true, awayTeam: true },
  });
  if (!pick) throw new AppError("NOT_FOUND", "No such selection.");
  if (pick.status !== "PENDING") {
    throw new AppError("BAD_REQUEST", `This selection is already ${pick.status.toLowerCase()} and the result stands.`);
  }

  await db.specialPick.update({ where: { id: pickId }, data: { status: "VOID", settledAt: now } });
  const rolled = pick.slipId ? await rollUpSlip(pick.slipId, now) : null;

  await audit(actorId, "special.pick.void", pickId, {
    reason: trimmed.slice(0, 500),
    date: accraDate(pick.forDate),
    position: pick.position,
    fixture: `${pick.homeTeam} v ${pick.awayTeam}`,
    slipRolledUpTo: rolled,
  });
  logger.warn("special.pick_voided_by_admin", { pickId, actorId, rolled });
  return { rolled };
}

/**
 * Voids a whole slip and every open leg on it.
 *
 * For the case the leg-level action cannot express: the slip as published should not stand at all.
 * Already-graded legs keep their results - voiding the slip is a statement about the product, not
 * a licence to rewrite what happened on the pitch.
 */
export async function voidSpecialSlip(actorId: string, slipId: string, reason: string, now = new Date()) {
  const trimmed = reason.trim();
  if (trimmed.length < 4) throw new AppError("BAD_REQUEST", "Give a reason; it is kept with the record.");

  const slip = await db.specialSlip.findUnique({
    where: { id: slipId },
    include: { picks: { select: { id: true, status: true } } },
  });
  if (!slip) throw new AppError("NOT_FOUND", "No such slip.");
  if (slip.status !== "PENDING") {
    throw new AppError("BAD_REQUEST", `This slip is already ${slip.status.toLowerCase()} and the result stands.`);
  }

  const open = slip.picks.filter((p) => p.status === "PENDING").map((p) => p.id);
  await db.$transaction([
    db.specialPick.updateMany({ where: { id: { in: open } }, data: { status: "VOID", settledAt: now } }),
    db.specialSlip.update({ where: { id: slipId }, data: { status: "VOID", settledAt: now } }),
  ]);

  await audit(actorId, "special.slip.void", slipId, {
    reason: trimmed.slice(0, 500),
    reference: slip.reference,
    legsVoided: open.length,
  });
  logger.warn("special.slip_voided_by_admin", { slipId, actorId, legsVoided: open.length });
  return { legsVoided: open.length };
}

export type JobStatus = {
  key: string;
  label: string;
  /** The cron expression, in UTC, which is also Accra time. */
  schedule: string;
  /** What this job leaves behind when it works, named so the reading can be checked. */
  evidence: string;
  lastAt: Date | null;
  ageMs: number | null;
  state: "ok" | "warn" | "bad";
  note: string;
};

/**
 * Whether the scheduled jobs are running, judged by what they leave behind.
 *
 * There is no job-run log to read, so this infers each job's health from its own effects: the
 * newest publication, the newest graded selection, the newest recorded price. That is weaker than
 * a real log in one specific way, stated on the page itself - a job with nothing to do leaves no
 * trace, so quiet is not proof of failure.
 *
 * It is not weaker in the way that mattered. `refreshSpecialOdds` ran daily for weeks and could
 * never match a row, and against this view its evidence would have read "never" from the first day.
 */
export async function pipelineStatus(now = new Date()): Promise<JobStatus[]> {
  const [slip, pick, odds, todaySlip] = await Promise.all([
    db.specialSlip.aggregate({ _max: { publishedAt: true } }),
    db.specialPick.aggregate({ _max: { settledAt: true } }),
    db.specialPickOdds.aggregate({ _max: { checkedAt: true } }),
    db.specialSlip.findUnique({ where: { forDate: new Date(accraDate(now)) }, select: { reference: true } }),
  ]);

  const build = (
    key: string,
    label: string,
    schedule: string,
    evidence: string,
    lastAt: Date | null,
    extra?: string,
  ): JobStatus => {
    const ageMs = lastAt ? now.getTime() - lastAt.getTime() : null;
    // Never is the loud case. Beyond two days is a question rather than a verdict, because a job
    // with nothing to do is indistinguishable from one that is broken when read this way.
    const state: JobStatus["state"] = lastAt === null ? "bad" : ageMs! > 2 * 86_400_000 ? "warn" : "ok";
    const note =
      lastAt === null
        ? "No evidence this has ever run."
        : state === "warn"
          ? "Nothing for over two days. Legitimate on a quiet run, worth checking otherwise."
          : (extra ?? "Running.");
    return { key, label, schedule, evidence, lastAt, ageMs, state, note };
  };

  return [
    build(
      "publish",
      "Publish the day's slip",
      "0 7 * * *",
      "newest special_slips.published_at",
      slip._max.publishedAt,
      todaySlip ? `Today's slip is ${todaySlip.reference}.` : "No slip today - legitimate when nothing qualified.",
    ),
    build("settle", "Grade finished selections", "30 3 * * *", "newest special_picks.settled_at", pick._max.settledAt),
    build("refresh", "Re-read prices", "0 15 * * *", "newest special_pick_odds.checked_at", odds._max.checkedAt),
  ];
}

export type DryRun = {
  date: string;
  bookmaker: string | null;
  returned: number;
  onDate: number;
  rejected: { reason: string; count: number }[];
  candidates: number;
  fixtures: { home: string; away: string; kickoffAt: Date; markets: number }[];
  note: string;
};

/**
 * What a run for `date` would have to work with, without publishing anything.
 *
 * Stops short of the research stage on purpose. Researching a fixture costs requests against a
 * metered provider whose daily allowance the real 07:00 run needs, and a dashboard that can empty
 * it by being refreshed is a liability. So this answers the cheap half of the question - which
 * fixtures survive the date rule and how many priced markets they carry - and says plainly that it
 * has not judged any of them.
 *
 * It calls the generator's own `priceSource`, so a day that looks empty here is empty for the same
 * reason it would be at 07:00.
 */
export async function dryRunDate(date: string, now = new Date()): Promise<DryRun> {
  const source = await priceSource();
  if (!source) {
    return {
      date,
      bookmaker: null,
      returned: 0,
      onDate: 0,
      rejected: [],
      candidates: 0,
      fixtures: [],
      note: "No bookmaker is connected to live prices, so a run would publish nothing.",
    };
  }

  const fixtures = await source.listUpcomingWithOffers({ hours: 36, pages: 3 }).catch((err: unknown) => {
    logger.error("admin.dryrun_offers_failed", { date, err: String(err) });
    return [];
  });

  const verdicts = fixtures.map((f) => ({ f, verdict: fixtureAllowedOn(f.event, date, now) }));
  const onDate = verdicts.filter((v) => v.verdict.ok).map((v) => v.f);
  const tally = new Map<string, number>();
  for (const { verdict } of verdicts) if (!verdict.ok) tally.set(verdict.reason, (tally.get(verdict.reason) ?? 0) + 1);

  const candidates = dedupe(candidatesFrom(source.slug, onDate));
  const perFixture = new Map<string, number>();
  for (const c of candidates) perFixture.set(c.event.externalId, (perFixture.get(c.event.externalId) ?? 0) + 1);

  return {
    date,
    bookmaker: source.slug,
    returned: fixtures.length,
    onDate: onDate.length,
    rejected: [...tally.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    candidates: candidates.length,
    fixtures: onDate.slice(0, 20).map((f) => ({
      home: f.event.home,
      away: f.event.away,
      kickoffAt: f.event.kickoffAt,
      markets: perFixture.get(f.event.externalId) ?? 0,
    })),
    note: "Fixtures and priced markets only. No statistics were read and nothing was judged or published.",
  };
}
