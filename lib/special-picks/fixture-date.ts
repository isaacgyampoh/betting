/**
 * Which calendar day a fixture belongs to, and whether it may enter that day's slip.
 *
 * A daily slip is a bet on one date. The generator used to take whatever the bookmaker's
 * `listUpcomingWithOffers({ hours: 36 })` returned, and on a Friday morning that is overwhelmingly
 * Saturday: measured on 2026-11-06, the window held 57 fixtures of which 7 were Friday's and 50
 * were Saturday's. Nothing filtered them, so Friday's published slip carried Bristol City v Norwich
 * from Saturday lunchtime - a leg that could not settle on the day the slip was dated, and that
 * nobody reading "Friday 6 November" would expect to be waiting on.
 *
 * The rule is therefore a hard one and it lives here rather than in the generator, so that the same
 * check runs when fixtures are discovered and again immediately before publication. A slip is
 * published only from fixtures whose kick-off falls on its own date in Africa/Accra.
 *
 * There is deliberately no widening. If a day has no qualifying selections the day has no slip;
 * reaching into tomorrow to find a second leg is what produced the bug.
 */

export const ACCRA_TZ = "Africa/Accra";

/**
 * Formatted rather than arithmetic, because the arithmetic is the trap.
 *
 * `toISOString().slice(0, 10)` is what this code did, and it gave the right answer only because
 * Ghana sits at UTC+0 all year and has observed no DST since 1942. That is a fact about Ghana, not
 * about the code: the same line is silently wrong for any other market, and nothing in it records
 * which of the two it is relying on. Asking Intl for the date in a named zone cannot drift.
 *
 * en-CA because it formats as YYYY-MM-DD, which is the shape the rest of the system stores.
 */
const ACCRA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: ACCRA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in Accra, as YYYY-MM-DD. Throws on an unusable instant rather than guessing. */
export function accraDate(instant: Date): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError("accraDate needs a valid Date");
  }
  return ACCRA_DAY.format(instant);
}

/** Whether a kick-off falls on `date` (YYYY-MM-DD) in Accra. A kick-off we cannot read is never on it. */
export function isOnAccraDate(kickoffAt: Date | null | undefined, date: string): boolean {
  if (!(kickoffAt instanceof Date) || Number.isNaN(kickoffAt.getTime())) return false;
  return accraDate(kickoffAt) === date;
}

/** What a fixture must look like to be considered. Matches the adapter's event shape structurally. */
export type DatedFixture = {
  kickoffAt: Date | null | undefined;
  status?: string | null;
};

export type DateVerdict = { ok: true } | { ok: false; reason: string };

/** Statuses that mean the match is not going to be played as listed. */
const DEAD = new Set(["POSTPONED", "CANCELLED", "CANCELED", "ABANDONED", "SUSPENDED", "DELAYED"]);

/** Statuses that mean it is already under way or over. */
const GONE = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "ENDED", "FINISHED", "FT", "AET", "PEN"]);

/**
 * Whether this fixture may go into the slip for `date`.
 *
 * Returns a reason rather than a bare false so the generator's log says which rule rejected what.
 * Silent filtering is how the original bug survived: a Saturday fixture was simply treated like any
 * other candidate, and there was no line anywhere saying a date had been considered at all.
 */
export function fixtureAllowedOn(fixture: DatedFixture, date: string, now: Date): DateVerdict {
  const { kickoffAt, status } = fixture;

  if (!(kickoffAt instanceof Date) || Number.isNaN(kickoffAt.getTime())) {
    return { ok: false, reason: "kickoff is missing or unreadable" };
  }
  // A timestamp decades from the date being built is not a kick-off, it is a bad feed value.
  const yearsOff = Math.abs(kickoffAt.getTime() - now.getTime()) / (365 * 24 * 3600_000);
  if (yearsOff > 1) return { ok: false, reason: "kickoff is implausibly far from now" };

  const s = (status ?? "").toUpperCase();
  if (DEAD.has(s)) return { ok: false, reason: `fixture is ${s.toLowerCase()}` };
  if (GONE.has(s)) return { ok: false, reason: "fixture has already started or finished" };

  const on = accraDate(kickoffAt);
  if (on !== date) return { ok: false, reason: `kicks off on ${on}, not ${date}` };

  // Checked after the date, because "yesterday's game" and "today's game that has begun" are
  // different problems and the log should not call the first one the second.
  if (kickoffAt.getTime() <= now.getTime()) return { ok: false, reason: "kickoff has passed" };

  return { ok: true };
}
