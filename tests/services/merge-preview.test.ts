import { describe, expect, it } from "vitest";
import { previewMerge, type MergePick } from "@/lib/services/merge";
import type { SlipRecord } from "@/lib/services/slips";

/**
 * Deciding what a merge would actually send.
 *
 * The rule worth testing is the one about duplicates. A bookmaker refuses a coupon carrying the
 * same selection twice, so something has to happen when two slips share a leg - and all three
 * obvious answers are wrong in different ways. Dropping them quietly makes the user's leg count
 * disagree with the code they get. Refusing the merge makes a common, harmless situation fatal.
 * Sending them produces a booking the destination rejects after all the work is done.
 *
 * So they are kept once and reported, and the caller shows the user.
 */

/** A selection shaped the way a SlipRecord carries one. */
function selection(
  position: number,
  over: Partial<{
    home: string;
    away: string;
    kickoff: string;
    type: string;
    outcome: string;
    line: number | null;
    period: string;
    status: string;
  }> = {},
) {
  return {
    position,
    homeTeam: over.home ?? "Arsenal",
    awayTeam: over.away ?? "Chelsea",
    kickoffAt: new Date(over.kickoff ?? "2026-10-19T19:00:00.000Z"),
    competition: "Premier League",
    status: over.status ?? "OK",
    odds: 1.85,
    marketType: over.type ?? "MATCH_RESULT",
    period: over.period ?? "FT",
    outcome: over.outcome ?? "HOME",
    line: over.line ?? null,
    bookmakerEvent: { externalId: "sr:match:1" },
  } as unknown as SlipRecord["selections"][number];
}

function slip(id: string, selections: SlipRecord["selections"]): SlipRecord {
  return {
    id,
    bookmaker: { id: `bk-${id}`, slug: "sportybet", name: "SportyBet" },
    selections,
  } as unknown as SlipRecord;
}

const pick = (slipId: string, position: number): MergePick => ({ slipId, position });

describe("previewing a merge", () => {
  it("accepts legs from different slips", () => {
    const a = slip("a", [selection(1)]);
    const b = slip("b", [selection(1, { home: "Spurs", away: "Everton" })]);

    const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
    expect(out.accepted).toHaveLength(2);
    expect(out.duplicates).toHaveLength(0);
  });

  describe("the same bet from two slips", () => {
    const a = slip("a", [selection(1)]);
    const b = slip("b", [selection(1)]); // identical fixture, market, outcome and line

    it("keeps it once so the merge can proceed", () => {
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.accepted).toHaveLength(1);
    });

    it("reports it rather than dropping it silently", () => {
      // The user chose two legs and will get one. They have to be told which, and why.
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.duplicates).toHaveLength(1);
      expect(out.duplicates[0].picks).toHaveLength(2);
      expect(out.duplicates[0].fixture).toContain("Arsenal");
      expect(out.duplicates[0].market).toContain("MATCH_RESULT");
    });

    it("survives the same slip being imported twice", () => {
      // Importing one slip twice is the commonest way this happens, and it must not be fatal.
      const out = previewMerge([a], [pick("a", 1), pick("a", 1)]);
      expect(out.accepted).toHaveLength(1);
      expect(out.duplicates).toHaveLength(1);
    });
  });

  describe("what counts as the same bet", () => {
    it("treats a different line as a different bet", () => {
      // Over 2.5 and Over 1.5 are not the same wager, and collapsing them would silently
      // substitute one for the other.
      const a = slip("a", [selection(1, { type: "OVER_UNDER", outcome: "OVER", line: 2.5 })]);
      const b = slip("b", [selection(1, { type: "OVER_UNDER", outcome: "OVER", line: 1.5 })]);
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.accepted, "both legs must survive").toHaveLength(2);
      expect(out.duplicates).toHaveLength(0);
    });

    it("treats a different outcome on the same market as a different bet", () => {
      const a = slip("a", [selection(1, { outcome: "HOME" })]);
      const b = slip("b", [selection(1, { outcome: "AWAY" })]);
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.accepted).toHaveLength(2);
      expect(out.duplicates).toHaveLength(0);
    });

    it("treats a different period as a different bet", () => {
      const a = slip("a", [selection(1, { period: "FT" })]);
      const b = slip("b", [selection(1, { period: "H1" })]);
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.accepted).toHaveLength(2);
      expect(out.duplicates).toHaveLength(0);
    });

    it("treats the same market on a different fixture as a different bet", () => {
      const a = slip("a", [selection(1, { home: "Arsenal", away: "Chelsea" })]);
      const b = slip("b", [selection(1, { home: "Spurs", away: "Everton" })]);
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.accepted).toHaveLength(2);
      expect(out.duplicates).toHaveLength(0);
    });

    it("treats the same teams at a different kickoff as a different fixture", () => {
      // Two legs of a cup tie. Same names, different games.
      const a = slip("a", [selection(1, { kickoff: "2026-10-19T19:00:00.000Z" })]);
      const b = slip("b", [selection(1, { kickoff: "2026-10-26T19:00:00.000Z" })]);
      const out = previewMerge([a, b], [pick("a", 1), pick("b", 1)]);
      expect(out.accepted).toHaveLength(2);
      expect(out.duplicates).toHaveLength(0);
    });
  });

  describe("refusing what it cannot do", () => {
    it("rejects a pick that is not on the slip it names", () => {
      const a = slip("a", [selection(1)]);
      expect(() => previewMerge([a], [pick("a", 9)])).toThrowError(/isn't on the slip/);
    });

    it("rejects a pick naming a slip that was not supplied", () => {
      const a = slip("a", [selection(1)]);
      expect(() => previewMerge([a], [pick("missing", 1)])).toThrowError(/isn't on the slip/);
    });
  });

  it("preserves the order the user chose", () => {
    const a = slip("a", [selection(1, { home: "Arsenal" }), selection(2, { home: "Spurs" })]);
    const b = slip("b", [selection(1, { home: "Liverpool" })]);
    const out = previewMerge([a, b], [pick("a", 2), pick("b", 1), pick("a", 1)]);
    expect(out.accepted.map((p) => `${p.slipId}:${p.position}`)).toEqual(["a:2", "b:1", "a:1"]);
  });
});
