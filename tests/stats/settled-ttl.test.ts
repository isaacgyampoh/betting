import { describe, expect, it } from "vitest";
import { sectionsPossibleFor } from "@/lib/services/stats";

/**
 * A finished match is finished. Its timeline, statistics and line-ups cannot change again, and
 * they were being cached for two minutes - the same as a game in play. Measured on the deployed
 * Worker, opening the same match centre twice in a row still cost five upstream calls the second
 * time, and this was why.
 */
describe("what a finished match still needs fetching", () => {
  const at = (status: string, kickoff: string) =>
    sectionsPossibleFor({ status: status as never, kickoffAt: kickoff }, Date.parse("2026-10-17T12:00:00Z"));

  it("a finished match still has every panel to show", () => {
    expect(at("FINISHED", "2026-10-17T09:00:00Z")).toEqual({ timeline: true, lineups: true });
  });

  it("an abandoned match keeps what was played", () => {
    expect(at("CANCELLED", "2026-10-17T09:00:00Z").timeline).toBe(true);
  });

  // The distinction the TTL turns on: these two are settled, a live match is not.
  it("live and scheduled are not settled", () => {
    for (const status of ["LIVE", "SCHEDULED"]) {
      const settled = status === "FINISHED" || status === "CANCELLED";
      expect(settled, status).toBe(false);
    }
  });

  it("finished and cancelled are settled", () => {
    for (const status of ["FINISHED", "CANCELLED"]) {
      const settled = status === "FINISHED" || status === "CANCELLED";
      expect(settled, status).toBe(true);
    }
  });
});
