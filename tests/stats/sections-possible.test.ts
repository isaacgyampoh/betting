import { describe, expect, it } from "vitest";
import { LINEUP_LEAD_MINUTES, sectionsPossibleFor } from "@/lib/services/stats";

/**
 * One match centre costs nine upstream calls and API-Football allows three hundred a minute, so
 * two wasted calls per scheduled fixture is the difference between about thirty-three and about
 * fifty match opens a minute. These are the calls that cannot return anything.
 */
describe("which sections a fixture could possibly have", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const at = (status: string, kickoff: string) =>
    sectionsPossibleFor({ status: status as never, kickoffAt: kickoff }, now);

  it("a match hours away has neither a timeline nor a team sheet", () => {
    expect(at("SCHEDULED", "2026-10-16T19:00:00Z")).toEqual({ timeline: false, lineups: false });
  });

  it("a team sheet becomes worth asking for shortly before kick-off", () => {
    const soon = new Date(now + (LINEUP_LEAD_MINUTES - 5) * 60_000).toISOString();
    expect(at("SCHEDULED", soon)).toEqual({ timeline: false, lineups: true });
  });

  it("the lead time is a boundary, not a gap", () => {
    const exactly = new Date(now + LINEUP_LEAD_MINUTES * 60_000).toISOString();
    const justOutside = new Date(now + (LINEUP_LEAD_MINUTES + 1) * 60_000).toISOString();
    expect(at("SCHEDULED", exactly).lineups).toBe(true);
    expect(at("SCHEDULED", justOutside).lineups).toBe(false);
  });

  it("a live match has everything", () => {
    expect(at("LIVE", "2026-10-16T11:30:00Z")).toEqual({ timeline: true, lineups: true });
  });

  it("a finished match has everything", () => {
    expect(at("FINISHED", "2026-10-16T09:00:00Z")).toEqual({ timeline: true, lineups: true });
  });

  // A match abandoned at 70 minutes still has the seventy minutes that were played, and a
  // postponed one may carry the team sheets that were announced before it was called off.
  it("abandoned and postponed matches keep what already happened", () => {
    expect(at("CANCELLED", "2026-10-16T09:00:00Z").timeline).toBe(true);
    expect(at("POSTPONED", "2026-10-16T09:00:00Z").timeline).toBe(true);
  });

  it("an unparseable kick-off time does not silently suppress the team sheet", () => {
    expect(at("SCHEDULED", "not a date").lineups).toBe(true);
  });
});
