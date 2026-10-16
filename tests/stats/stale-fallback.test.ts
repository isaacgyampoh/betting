import { describe, expect, it } from "vitest";

/**
 * "Serve stale rather than nothing" has a limit, and this is where it is.
 *
 * Found on the device: selecting a date three days past showed 136 matches still "scheduled" and
 * four still in play with running clocks. The provider had 274 finished and nothing live. Our
 * cached row for that date had been written at 12:42 on the day itself and expired at 12:57 -
 * three days earlier - and a provider rate-limit sent the request down the stale fallback, which
 * had no age limit at all.
 *
 * Stale beats nothing for a minute. It does not beat nothing for three days, because the app has
 * no way to tell the difference and shows it as current.
 */
describe("how stale is too stale", () => {
  const GRACE_MS = 60 * 60_000;

  /** The rule the provider applies before serving an expired row. */
  const servable = (expiresAt: Date, now: Date) =>
    now.getTime() - expiresAt.getTime() <= GRACE_MS;

  const now = new Date("2026-10-16T13:00:00Z");

  it("serves a row that expired moments ago", () => {
    expect(servable(new Date("2026-10-16T12:59:00Z"), now)).toBe(true);
  });

  it("serves a row that expired half an hour ago", () => {
    expect(servable(new Date("2026-10-16T12:30:00Z"), now)).toBe(true);
  });

  it("refuses the three-day-old snapshot that caused the bug", () => {
    // The exact row: written 2026-10-13 12:42, expired 12:57.
    expect(servable(new Date("2026-10-13T12:57:39Z"), now)).toBe(false);
  });

  it("refuses anything past the grace window", () => {
    expect(servable(new Date("2026-10-16T11:59:00Z"), now)).toBe(false);
  });

  it("the boundary is inclusive, so exactly one hour still serves", () => {
    expect(servable(new Date("2026-10-16T12:00:00Z"), now)).toBe(true);
  });
});

/**
 * A past day's fixtures are final, so they are cached for a day; today's change constantly, so
 * they are cached for minutes. The bug was not this rule - it was that an entry written under the
 * short TTL kept being served long after it lapsed.
 */
describe("fixture list cache lifetime", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const ttlFor = (date: string, today: string) => (date < today ? 24 * HOUR : 15 * MIN);

  it("a finished day is held for a day", () => {
    expect(ttlFor("2026-10-13", "2026-10-16")).toBe(24 * HOUR);
  });

  it("today is held for minutes, because scores move", () => {
    expect(ttlFor("2026-10-16", "2026-10-16")).toBe(15 * MIN);
  });

  it("a future day is treated like today, because fixtures get moved", () => {
    expect(ttlFor("2026-10-20", "2026-10-16")).toBe(15 * MIN);
  });
});
