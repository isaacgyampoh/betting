/**
 * What is wrong with a slip that has already been published.
 *
 * The generator decides what to publish; this decides what to say about it afterwards, and the two
 * are deliberately separate. Every rule here exists because something reached production that
 * nobody could see:
 *
 *   * Friday 6 November's slip carried a Saturday fixture. The date was never compared to the
 *     slip's own day, so nothing anywhere said so.
 *   * Its lead leg was priced at 1.06 against our own estimate of 0.90 - a 4.6% loss per unit
 *     staked. The arithmetic is one multiplication and it was never shown.
 *   * `refreshSpecialOdds` could not match a row for weeks, so prices were never re-read. The only
 *     evidence was an absence, and an absence is not something a dashboard displays by accident.
 *
 * So the rules are stated as findings with the numbers in them, not as a score or a colour. An
 * administrator should be able to read one line and know both what is wrong and what it costs.
 *
 * Pure on purpose: no database, no clock of its own, no bookmaker. Everything it judges arrives as
 * an argument, which is what makes the awkward cases - a slip whose legs all voided, a price that
 * moved after kick-off - cheap enough to write tests for.
 */

import { DEFAULT_THRESHOLD, edge, type Threshold } from "@/lib/special-picks/assess";
import { accraDate } from "@/lib/special-picks/fixture-date";

/**
 * How much attention a finding deserves.
 *
 * `bad` means the slip should not have gone out as it did. `warn` means it is worth a look before
 * the next one. `info` is a fact that is not a fault - a price moving is the market disagreeing
 * with us, which is information rather than a mistake, and filing it as a warning would train
 * whoever reads this page to ignore warnings.
 */
export type Severity = "bad" | "warn" | "info";

export type Finding = {
  /** Stable identifier, safe to match on in tests and alerts. */
  code: string;
  severity: Severity;
  /** One sentence, with the numbers in it, that an administrator can act on. */
  message: string;
};

export type LegStatus = "PENDING" | "WON" | "LOST" | "VOID";

export type LegUnderReview = {
  position: number;
  kickoffAt: Date;
  status: LegStatus;
  /** The price it was published at. Null when no bookmaker price could be verified. */
  odds: number | null;
  /** Our own estimate, 0..1. Never a price. */
  probability: number;
  /** How many matches the estimate rests on. */
  sample: number;
  /** The most recent price observed since, if the refresh job has ever seen one. */
  latestOdds: number | null;
  latestOddsAt: Date | null;
};

export type SlipUnderReview = {
  /** The day the slip is dated, YYYY-MM-DD in Accra. */
  forDate: string;
  combinedOdds: number | null;
  status: LegStatus;
  publishedAt: Date;
  lastVerifiedAt: Date | null;
  legs: LegUnderReview[];
};

/** The shape a slip is supposed to have. Passed in, because the generator owns these numbers. */
export type SlipShape = {
  band: { min: number; max: number };
  legs: { min: number; max: number };
};

/**
 * How long a price may go unchecked before the slip is quoting history.
 *
 * Eight hours rather than a day: the slip is published at 07:00 for fixtures that evening, so a
 * price unchecked for a working day has had the whole run-up to move without anyone noticing.
 */
export const STALE_PRICE_MS = 8 * 60 * 60_000;

/**
 * How long after kick-off a pending leg stops being "waiting" and starts being "stuck".
 *
 * Settlement already waits three hours before it will grade a match. This is deliberately longer:
 * the question here is not "may this be graded yet" but "has grading silently stopped happening",
 * and asking the second question too early would flag every match still in progress.
 */
export const OVERDUE_AFTER_MS = 6 * 60 * 60_000;

/** A price that has moved less than this is noise, not news. */
const MOVE_FLOOR = 0.05;

/**
 * How far below zero an edge has to be before it is called a loss.
 *
 * Break-even is not a loss, and in floating point it is not reliably zero either: a probability of
 * 0.72 against a price of 1/0.72 comes out at −1.1e−16, which a bare `< 0` reports as a bet that
 * loses money, in a sentence reading "−0.0% per unit staked". Accusing a selection of something
 * that precise and that wrong is worse than saying nothing. Anything inside this floor falls
 * through to the gate rule, which describes it accurately as an edge too thin to publish.
 */
const LOSS_FLOOR = 1e-9;

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const hours = (ms: number) => {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} days`;
};

/**
 * Expected return per unit staked, as a percentage string, or null when there is no price.
 *
 * Exported because the desk prints it next to every leg whether or not it is a problem. The number
 * being visible at all times is most of the point: the Alavés leg was not published in defiance of
 * this figure, it was published without anybody ever computing it.
 */
export function expectedValue(probability: number, odds: number | null): number | null {
  return edge(probability, odds);
}

/**
 * Everything wrong with one leg, worst first.
 *
 * `slipDate` is the slip's own day, not the leg's. That asymmetry is the whole point of the first
 * rule: a leg is not judged against the day it happens to kick off on, it is judged against the
 * day it was sold as part of.
 */
export function legFindings(
  leg: LegUnderReview,
  slipDate: string,
  now: Date,
  t: Threshold = DEFAULT_THRESHOLD,
): Finding[] {
  const out: Finding[] = [];
  const settled = leg.status !== "PENDING";

  // --- the day it belongs to -------------------------------------------------
  const day = accraDate(leg.kickoffAt);
  if (day !== slipDate) {
    out.push({
      code: "off-day",
      severity: "bad",
      message: `Kicks off on ${day}, but the slip is dated ${slipDate}. A daily slip may only contain that day's fixtures.`,
    });
  }

  // --- what the price is actually worth --------------------------------------
  const ev = edge(leg.probability, leg.odds);
  if (leg.odds === null) {
    out.push({
      code: "unpriced",
      severity: "warn",
      message: "Published with no verified bookmaker price, so its value cannot be checked.",
    });
  } else if (ev !== null && ev < -LOSS_FLOOR) {
    out.push({
      code: "priced-at-a-loss",
      severity: "bad",
      message:
        `Loses money at the published price: ${leg.probability.toFixed(2)} × ${leg.odds} = ` +
        `${(leg.probability * leg.odds).toFixed(3)}, ${pct(ev)} per unit staked.`,
    });
  } else if (ev !== null && ev < t.minEdge) {
    out.push({
      code: "below-gate",
      severity: "warn",
      message: `${pct(ev)} expected, under the ${pct(t.minEdge)} gate a selection must clear to be published.`,
    });
  }

  // --- how much is behind the estimate ---------------------------------------
  if (leg.sample < t.minSample) {
    out.push({
      code: "thin-evidence",
      severity: "warn",
      message: `Rests on ${leg.sample} matches; ${t.minSample} is the minimum the generator accepts.`,
    });
  }

  // --- the price since -------------------------------------------------------
  if (leg.odds !== null && leg.latestOdds !== null && leg.latestOdds !== leg.odds) {
    const move = leg.latestOdds / leg.odds - 1;
    if (Math.abs(move) >= MOVE_FLOOR) {
      out.push({
        code: "price-moved",
        severity: "info",
        message:
          `Price has moved ${leg.odds} → ${leg.latestOdds} (${pct(move)}) since publication. ` +
          `The published price stands; this is the market's current view.`,
      });
    }
  }

  // --- whether anyone is still watching it -----------------------------------
  if (!settled && leg.kickoffAt.getTime() > now.getTime()) {
    const checked = leg.latestOddsAt;
    if (checked && now.getTime() - checked.getTime() > STALE_PRICE_MS) {
      out.push({
        code: "stale-price",
        severity: "warn",
        message:
          `Price last checked ${hours(now.getTime() - checked.getTime())} ago, ` +
          `kick-off in ${hours(leg.kickoffAt.getTime() - now.getTime())}.`,
      });
    } else if (!checked && leg.odds !== null) {
      out.push({
        code: "never-rechecked",
        severity: "warn",
        message: "The price has not been re-read once since publication.",
      });
    }
  }

  // --- whether settlement is happening ---------------------------------------
  if (!settled && now.getTime() - leg.kickoffAt.getTime() > OVERDUE_AFTER_MS) {
    out.push({
      code: "overdue",
      severity: "bad",
      message: `Kicked off ${hours(now.getTime() - leg.kickoffAt.getTime())} ago and has still not been graded.`,
    });
  }

  return out;
}

/**
 * Everything wrong with the slip as a whole.
 *
 * Separate from the legs because some faults belong to neither leg individually. A slip of two
 * perfectly good selections can still be the wrong product: priced outside its own band, or spread
 * across two days, or finished in every leg while the slip itself is somehow still open.
 */
export function slipFindings(slip: SlipUnderReview, now: Date, shape: SlipShape): Finding[] {
  const out: Finding[] = [];

  if (!slip.legs.length) {
    out.push({ code: "no-legs", severity: "bad", message: "The slip has no selections." });
    return out;
  }

  // The fault that produced this whole page. Stated once at the top, because a reader should not
  // have to notice it by comparing two kick-off times themselves.
  const days = [...new Set(slip.legs.map((l) => accraDate(l.kickoffAt)))].sort();
  if (days.length > 1) {
    out.push({
      code: "mixed-days",
      severity: "bad",
      message: `Selections span ${days.length} different days (${days.join(", ")}). A slip is a bet on one date.`,
    });
  }

  if (slip.legs.length < shape.legs.min || slip.legs.length > shape.legs.max) {
    out.push({
      code: "leg-count",
      severity: "warn",
      message: `${slip.legs.length} selections; a slip carries ${shape.legs.min} to ${shape.legs.max}.`,
    });
  }

  if (slip.combinedOdds !== null) {
    const { min, max } = shape.band;
    if (slip.combinedOdds < min - 1e-9 || slip.combinedOdds > max + 1e-9) {
      out.push({
        code: "off-band",
        severity: "warn",
        message:
          `Combined ${slip.combinedOdds} is outside the ${min}–${max} band the slip is built to hit.`,
      });
    }
  }

  // Every leg is done and the slip is not: the rollup that closes slips has not run. Worth saying
  // plainly, because the symptom is a slip that looks live on the public record for ever.
  if (slip.status === "PENDING" && slip.legs.every((l) => l.status !== "PENDING")) {
    out.push({
      code: "rollup-pending",
      severity: "bad",
      message: "Every selection has been graded but the slip is still open; the slip rollup has not run.",
    });
  }

  // A slip whose legs all voided is not a loss and must not be recorded as one.
  if (slip.legs.every((l) => l.status === "VOID") && slip.status !== "VOID") {
    out.push({
      code: "all-void",
      severity: "warn",
      message: `Every selection is void, so the slip should be void rather than ${slip.status.toLowerCase()}.`,
    });
  }

  if (slip.status === "PENDING" && !slip.lastVerifiedAt && now.getTime() - slip.publishedAt.getTime() > STALE_PRICE_MS) {
    out.push({
      code: "never-verified",
      severity: "warn",
      message: `Published ${hours(now.getTime() - slip.publishedAt.getTime())} ago and never re-verified against the bookmaker.`,
    });
  }

  return out;
}

const RANK: Record<Severity, number> = { bad: 2, warn: 1, info: 0 };

/** The most serious severity present, or null for a clean slip. */
export function worst(findings: readonly Finding[]): Severity | null {
  return findings.reduce<Severity | null>((acc, f) => (acc === null || RANK[f.severity] > RANK[acc] ? f.severity : acc), null);
}

/** Findings sorted worst first, which is the order the desk prints them in. */
export function bySeverity(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}
