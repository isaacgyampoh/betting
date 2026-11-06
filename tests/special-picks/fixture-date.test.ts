import { describe, expect, it } from "vitest";
import { accraDate, fixtureAllowedOn, isOnAccraDate } from "@/lib/special-picks/fixture-date";

/**
 * A daily slip belongs to one calendar day.
 *
 * This is the guard for a bug that reached production: Friday 6 November's slip carried Bristol
 * City v Norwich, kicking off Saturday 7 November at 12:30. The generator asked the bookmaker for
 * the next 36 hours and published from whatever came back. Measured that morning, the window held
 * 57 fixtures - 7 of Friday's and 50 of Saturday's - so the overwhelming majority of what it chose
 * from belonged to a day the slip was not for, and a leg of a "Friday" accumulator could not
 * settle until Saturday afternoon.
 *
 * Nothing below is about formatting. Each case is a way a fixture from another day, or no real day
 * at all, could get in.
 */

const FRI = "2026-11-06";
const SAT = "2026-11-07";
const SUN = "2026-11-08";
const MON = "2026-11-09";

/** Mid-afternoon on the Friday, so "now" is unambiguous for every case below. */
const NOW = new Date("2026-11-06T15:00:00.000Z");
const at = (iso: string) => new Date(iso);
const fixture = (iso: string, status = "NOT_STARTED") => ({ kickoffAt: at(iso), status });

describe("the date a fixture belongs to", () => {
  it("reads the calendar date in Accra", () => {
    expect(accraDate(at("2026-11-06T20:00:00.000Z"))).toBe(FRI);
    expect(accraDate(at("2026-11-07T12:30:00.000Z"))).toBe(SAT);
  });

  // Ghana is UTC+0 and has kept no DST since 1942, so these two agree - which is exactly why the
  // original `toISOString().slice(0, 10)` passed every test anyone wrote. The boundary cases are
  // pinned so that a change of approach has to keep agreeing with them.
  it("puts the minutes either side of midnight on the right day", () => {
    expect(accraDate(at("2026-11-06T23:59:59.999Z"))).toBe(FRI);
    expect(accraDate(at("2026-11-07T00:00:00.000Z"))).toBe(SAT);
    expect(accraDate(at("2026-11-07T00:00:00.001Z"))).toBe(SAT);
    expect(accraDate(at("2026-11-06T00:00:00.000Z"))).toBe(FRI);
  });

  it("refuses an instant it cannot read rather than inventing a day", () => {
    expect(() => accraDate(new Date("nonsense"))).toThrow();
    expect(() => accraDate(undefined as unknown as Date)).toThrow();
  });

  it("treats an unreadable kickoff as being on no date at all", () => {
    expect(isOnAccraDate(new Date("nonsense"), FRI)).toBe(false);
    expect(isOnAccraDate(null, FRI)).toBe(false);
    expect(isOnAccraDate(undefined, FRI)).toBe(false);
    expect(isOnAccraDate(at("2026-11-06T20:00:00.000Z"), FRI)).toBe(true);
  });
});

describe("which fixtures may enter a day's slip", () => {
  it("accepts a fixture kicking off later that day", () => {
    expect(fixtureAllowedOn(fixture("2026-11-06T20:00:00.000Z"), FRI, NOW)).toEqual({ ok: true });
  });

  // The exact leg that got through. Published on Friday, kicking off Saturday lunchtime.
  it("rejects the Saturday fixture that reached Friday's slip", () => {
    const verdict = fixtureAllowedOn(fixture("2026-11-07T12:30:00.000Z"), FRI, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining("2026-11-07") });
  });

  it("rejects the next day's fixtures on every day of the weekend", () => {
    const cases: [string, string, string][] = [
      [FRI, "2026-11-07T12:30:00.000Z", "Friday slip, Saturday fixture"],
      [SAT, "2026-11-08T14:00:00.000Z", "Saturday slip, Sunday fixture"],
      [SUN, "2026-11-09T19:45:00.000Z", "Sunday slip, Monday fixture"],
    ];
    for (const [date, kickoff, label] of cases) {
      // "now" is the morning of each slip's own day, as the 07:00 run would see it.
      const morning = new Date(`${date}T07:00:00.000Z`);
      expect(fixtureAllowedOn(fixture(kickoff), date, morning).ok, label).toBe(false);
    }
  });

  it("rejects yesterday's fixture as firmly as tomorrow's", () => {
    expect(fixtureAllowedOn(fixture("2026-11-05T20:00:00.000Z"), FRI, NOW).ok).toBe(false);
  });

  it("rejects a fixture a minute into the next day", () => {
    expect(fixtureAllowedOn(fixture("2026-11-07T00:00:30.000Z"), FRI, NOW).ok).toBe(false);
    expect(fixtureAllowedOn(fixture("2026-11-06T23:59:30.000Z"), FRI, NOW).ok).toBe(true);
  });

  it("rejects a kickoff that is missing or unreadable", () => {
    for (const bad of [null, undefined, new Date("nonsense")]) {
      const verdict = fixtureAllowedOn({ kickoffAt: bad, status: "NOT_STARTED" }, FRI, NOW);
      expect(verdict.ok, String(bad)).toBe(false);
      expect(verdict).toMatchObject({ reason: expect.stringContaining("missing or unreadable") });
    }
  });

  it("rejects a timestamp that is not plausibly a kickoff", () => {
    // A feed sending 1970 or 2099 is sending a default, not a fixture. Without this it would be
    // rejected anyway for being the wrong date - but for the wrong reason, and the log would say so.
    expect(fixtureAllowedOn(fixture("1970-01-01T00:00:00.000Z"), FRI, NOW)).toMatchObject({
      reason: expect.stringContaining("implausibly far"),
    });
  });

  it("rejects a postponed or cancelled fixture even when the date is right", () => {
    for (const status of ["POSTPONED", "CANCELLED", "ABANDONED", "SUSPENDED"]) {
      const verdict = fixtureAllowedOn(fixture("2026-11-06T20:00:00.000Z", status), FRI, NOW);
      expect(verdict.ok, status).toBe(false);
      expect(verdict).toMatchObject({ reason: expect.stringContaining(status.toLowerCase()) });
    }
  });

  it("rejects a fixture already under way or finished", () => {
    for (const status of ["LIVE", "IN_PLAY", "HALFTIME", "ENDED", "FINISHED"]) {
      expect(fixtureAllowedOn(fixture("2026-11-06T20:00:00.000Z", status), FRI, NOW).ok, status).toBe(false);
    }
  });

  it("rejects today's fixture whose kickoff has already passed", () => {
    const verdict = fixtureAllowedOn(fixture("2026-11-06T14:00:00.000Z"), FRI, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: "kickoff has passed" });
  });

  // The status field is the feed's opinion and it can be stale; the clock is not. A cached entry
  // still claiming NOT_STARTED for a match that kicked off an hour ago must not get through on the
  // strength of that claim.
  it("does not let a stale NOT_STARTED bypass the clock", () => {
    const started = fixtureAllowedOn(fixture("2026-11-06T09:00:00.000Z", "NOT_STARTED"), FRI, NOW);
    expect(started.ok).toBe(false);
  });

  // And a stale entry for yesterday is rejected on the date, whatever status it carries.
  it("does not let a stale cached fixture from another day through", () => {
    for (const status of ["NOT_STARTED", "", "UNKNOWN"]) {
      expect(fixtureAllowedOn(fixture("2026-11-07T12:30:00.000Z", status), FRI, NOW).ok, status).toBe(false);
    }
  });

  // There is no widening anywhere: the only date that passes is the one asked for. If that leaves
  // too few selections, the day gets no slip - which is the rule the original bug broke.
  it("admits exactly one date and never the next available one", () => {
    const kickoffs = [
      "2026-11-05T20:00:00.000Z",
      "2026-11-06T20:00:00.000Z",
      "2026-11-07T12:30:00.000Z",
      "2026-11-08T16:00:00.000Z",
    ];
    const accepted = kickoffs.filter((k) => fixtureAllowedOn(fixture(k), FRI, NOW).ok);
    expect(accepted).toEqual(["2026-11-06T20:00:00.000Z"]);
  });

  it("applies the same single-date rule to every day asked for", () => {
    const kickoffs = ["2026-11-06T20:00:00.000Z", "2026-11-07T12:30:00.000Z", "2026-11-08T16:00:00.000Z"];
    for (const [date, expected] of [[FRI, 1], [SAT, 1], [SUN, 1], [MON, 0]] as const) {
      const morning = new Date(`${date}T07:00:00.000Z`);
      const kept = kickoffs.filter((k) => fixtureAllowedOn(fixture(k), date, morning).ok);
      expect(kept.length, date).toBe(expected);
    }
  });
});
