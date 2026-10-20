import { describe, expect, it } from "vitest";
import { dayTtlMs, overlayLiveRows } from "@/lib/stats/api-football";
import type { MatchSummary } from "@/lib/stats/types";

/**
 * How stale a score is allowed to be.
 *
 * The reported symptom was GameClaw showing a match at 37' while Flashscore and SofaScore showed
 * 44-45'. It was not a clock bug: the app renders whatever the server sends, and the server was
 * sending a quarter-of-an-hour-old row. One cache entry held both the day's fixture roster and
 * every live score in it, on a 15-minute lifetime.
 *
 * Measured against production on 19 Oct before the fix, polling every 30s:
 *
 *   Goias            50' 50' 50' 50' 50' 50' 50' -> 65'    frozen 4m, then a 15' jump
 *   Newells          79' ...                      -> 90'
 *   Corinthians      37' ...                      -> Halftime
 *
 * After, polling the patched provider every 40s, the minute advanced 4' over four minutes of wall
 * clock - 32' 32' 33' 34' 34' 35' 36' - which is the provider's own granularity.
 *
 * These tests hold the two decisions that produced that, so neither can be quietly undone: the
 * roster's lifetime, and the rule that the live feed wins for matches it knows about.
 */
function summary(id: number, label: string, home = 0, away = 0): MatchSummary {
  return {
    id,
    kickoffAt: "2026-10-19T19:00:00.000Z",
    status: "LIVE",
    statusLabel: label,
    league: { id: 39, name: "Premier League", country: "England", season: 2026, logo: null },
    home: { id: 1, name: "Arsenal", logo: null },
    away: { id: 2, name: "Chelsea", logo: null },
    goals: { home, away },
    halftime: null,
  } as unknown as MatchSummary;
}

describe("how long a day's roster is cached", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  it("keeps today short, because only the roster can retire a finished match", () => {
    // A match that has ended drops out of the live feed entirely, so the overlay cannot correct
    // it. Whatever this is, it is the worst case for a full-time score appearing.
    expect(dayTtlMs("2026-10-19", now)).toBe(3 * 60_000);
  });

  it("never lets today drift back towards the 15 minutes that caused this", () => {
    expect(dayTtlMs("2026-10-19", now)).toBeLessThan(15 * 60_000);
  });

  it("holds a settled day for a day", () => {
    expect(dayTtlMs("2026-10-18", now)).toBe(24 * 60 * 60_000);
  });

  it("does not waste a short lifetime on fixtures that have not kicked off", () => {
    expect(dayTtlMs("2026-10-20", now)).toBe(15 * 60_000);
  });
});

describe("overlaying the live feed", () => {
  it("replaces a match the live feed knows about", () => {
    const day = [summary(1, "37'"), summary(2, "12'")];
    const live = [summary(1, "45'", 2, 1)];
    const out = overlayLiveRows(day, live);
    expect(out[0].statusLabel).toBe("45'");
    expect(out[0].goals).toEqual({ home: 2, away: 1 });
  });

  it("leaves matches the live feed does not mention alone", () => {
    const day = [summary(1, "37'"), summary(2, "12'")];
    const out = overlayLiveRows(day, [summary(1, "45'")]);
    expect(out[1].statusLabel).toBe("12'");
  });

  it("does not add a live match belonging to another date", () => {
    // Someone looking at a particular day asked for that day. A match that kicked off before
    // midnight UTC belongs to the previous date and must stay there.
    const day = [summary(1, "37'")];
    const out = overlayLiveRows(day, [summary(1, "45'"), summary(99, "70'")]);
    expect(out).toHaveLength(1);
    expect(out.map((m) => m.id)).toEqual([1]);
  });

  it("returns the day untouched when the live feed is empty", () => {
    // Which is also what a failed live fetch looks like. Slightly stale beats an error where the
    // scores should be.
    const day = [summary(1, "37'")];
    expect(overlayLiveRows(day, [])).toEqual(day);
  });

  it("keeps the day's order", () => {
    const day = [summary(3, "5'"), summary(1, "37'"), summary(2, "12'")];
    const out = overlayLiveRows(day, [summary(1, "45'")]);
    expect(out.map((m) => m.id)).toEqual([3, 1, 2]);
  });
});
