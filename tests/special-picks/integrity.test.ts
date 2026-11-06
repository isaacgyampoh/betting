import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLD } from "@/lib/special-picks/assess";
import {
  bySeverity,
  expectedValue,
  legFindings,
  slipFindings,
  worst,
  type LegUnderReview,
  type SlipUnderReview,
} from "@/lib/special-picks/integrity";

/**
 * The rules the Slip Desk reads a published slip with.
 *
 * Every one of these is pinned to something that actually went out. The two anchor cases are
 * Friday 6 November's slip: a lead selection priced at a loss, and a second leg belonging to the
 * following day. Neither was visible anywhere at the time, and a test that only checked the rule
 * in the abstract would not notice if the rule stopped recognising the case that produced it.
 */

const SHAPE = { band: { min: 1.9, max: 2.1 }, legs: { min: 2, max: 3 } };
const NOW = new Date("2026-11-06T09:00:00Z");

const leg = (over: Partial<LegUnderReview> = {}): LegUnderReview => ({
  position: 1,
  kickoffAt: new Date("2026-11-06T20:00:00Z"),
  status: "PENDING",
  odds: 1.9,
  probability: 0.72,
  sample: 10,
  latestOdds: null,
  latestOddsAt: new Date("2026-11-06T08:00:00Z"),
  ...over,
});

const codes = (f: { code: string }[]) => f.map((x) => x.code);

describe("Friday 6 November, the slip this page exists for", () => {
  /**
   * Sevilla v Alavés, over 4.5 shots on target, 1.06 against our own estimate of 0.90.
   *
   * The finding everybody missed. Sixteen matches out of sixteen is a real pattern and 1.06 reads
   * as a safe price; the product of the two is 0.954, which is a losing bet. The test asserts the
   * number as well as the code, because "there is a warning" is not the useful part.
   */
  it("calls the lead selection what it was: a bet that loses money", () => {
    const f = legFindings(leg({ odds: 1.06, probability: 0.9, sample: 16 }), "2026-11-06", NOW);
    expect(codes(f)).toContain("priced-at-a-loss");
    expect(f.find((x) => x.code === "priced-at-a-loss")!.message).toContain("−4.6%");
    expect(f.find((x) => x.code === "priced-at-a-loss")!.severity).toBe("bad");
    expect(expectedValue(0.9, 1.06)).toBeCloseTo(-0.046, 3);
  });

  /** Bristol City v Norwich, Saturday lunchtime, on a slip dated Friday. */
  it("calls the second leg what it was: somebody else's day", () => {
    const f = legFindings(leg({ kickoffAt: new Date("2026-11-07T12:30:00Z") }), "2026-11-06", NOW);
    const off = f.find((x) => x.code === "off-day")!;
    expect(off.severity).toBe("bad");
    expect(off.message).toContain("2026-11-07");
    expect(off.message).toContain("2026-11-06");
  });

  it("says the slip itself spans two days, so nobody has to compare kick-offs by eye", () => {
    const slip: SlipUnderReview = {
      forDate: "2026-11-06",
      combinedOdds: 1.887,
      status: "PENDING",
      publishedAt: new Date("2026-11-06T07:01:00Z"),
      lastVerifiedAt: null,
      legs: [leg({ odds: 1.06, probability: 0.9 }), leg({ position: 2, kickoffAt: new Date("2026-11-07T12:30:00Z") })],
    };
    const f = slipFindings(slip, NOW, SHAPE);
    expect(codes(f)).toContain("mixed-days");
    expect(f.find((x) => x.code === "mixed-days")!.message).toContain("2026-11-07");
    // 1.887 is below the 1.90-2.10 band the slip is supposed to hit.
    expect(codes(f)).toContain("off-band");
  });
});

describe("the value gate", () => {
  it("is quiet when the price clears the gate", () => {
    expect(codes(legFindings(leg({ odds: 1.9, probability: 0.72 }), "2026-11-06", NOW))).not.toContain("below-gate");
  });

  /**
   * Exactly at the gate is published, so exactly at the gate must not be flagged. An off-by-one
   * here would put a warning on every leg the generator deliberately let through.
   */
  it("accepts a price sitting exactly on the gate", () => {
    const odds = (1 + DEFAULT_THRESHOLD.minEdge) / 0.72;
    const f = legFindings(leg({ odds, probability: 0.72 }), "2026-11-06", NOW);
    expect(codes(f)).not.toContain("below-gate");
    expect(codes(f)).not.toContain("priced-at-a-loss");
  });

  it("separates a thin edge from a losing one", () => {
    // +2% - positive, but inside the error of our own estimate, so not publishable.
    const thin = legFindings(leg({ odds: 1.02 / 0.72, probability: 0.72 }), "2026-11-06", NOW);
    expect(codes(thin)).toContain("below-gate");
    expect(codes(thin)).not.toContain("priced-at-a-loss");
  });

  /**
   * Break-even, which in floating point is not zero: 0.72 x (1/0.72) - 1 comes out at -1.1e-16.
   * A bare `< 0` called that a bet that loses money and printed the verdict as "-0.0%".
   */
  it("treats a price with no edge at all as thin rather than losing", () => {
    const f = legFindings(leg({ odds: 1 / 0.72, probability: 0.72 }), "2026-11-06", NOW);
    expect(codes(f)).toContain("below-gate");
    expect(codes(f)).not.toContain("priced-at-a-loss");
  });

  it("says so when there was no price to judge, rather than inventing one", () => {
    const f = legFindings(leg({ odds: null }), "2026-11-06", NOW);
    expect(codes(f)).toContain("unpriced");
    expect(codes(f)).not.toContain("priced-at-a-loss");
    expect(codes(f)).not.toContain("below-gate");
    expect(expectedValue(0.72, null)).toBeNull();
  });

  it("flags an estimate resting on too few matches", () => {
    expect(codes(legFindings(leg({ sample: 4 }), "2026-11-06", NOW))).toContain("thin-evidence");
    expect(codes(legFindings(leg({ sample: DEFAULT_THRESHOLD.minSample }), "2026-11-06", NOW))).not.toContain(
      "thin-evidence",
    );
  });
});

describe("the price after publication", () => {
  /**
   * A move is information, not a fault. Filing it as a warning would be the fastest way to teach
   * whoever reads this page that the warnings are noise.
   */
  it("reports a real move as a note, never as a fault", () => {
    const f = legFindings(leg({ odds: 1.9, latestOdds: 2.2 }), "2026-11-06", NOW);
    const moved = f.find((x) => x.code === "price-moved")!;
    expect(moved.severity).toBe("info");
    expect(moved.message).toContain("1.9 → 2.2");
  });

  it("ignores a move too small to mean anything", () => {
    expect(codes(legFindings(leg({ odds: 1.9, latestOdds: 1.93 }), "2026-11-06", NOW))).not.toContain("price-moved");
  });

  it("says when a price has never been re-read at all", () => {
    expect(codes(legFindings(leg({ latestOddsAt: null }), "2026-11-06", NOW))).toContain("never-rechecked");
  });

  it("says when the last check has gone stale before kick-off", () => {
    const f = legFindings(
      leg({ latestOddsAt: new Date("2026-11-05T18:00:00Z") }),
      "2026-11-06",
      NOW,
    );
    expect(codes(f)).toContain("stale-price");
  });

  /** A settled leg's price is history. Nagging about it is noise on every past day for ever. */
  it("stops asking about the price once the leg is graded", () => {
    const f = legFindings(leg({ status: "WON", latestOddsAt: null }), "2026-11-06", NOW);
    expect(codes(f)).not.toContain("never-rechecked");
    expect(codes(f)).not.toContain("stale-price");
  });
});

describe("whether settlement is still happening", () => {
  it("flags a leg left pending long after kick-off", () => {
    const f = legFindings(
      leg({ kickoffAt: new Date("2026-11-04T20:00:00Z") }),
      "2026-11-04",
      NOW,
    );
    const overdue = f.find((x) => x.code === "overdue")!;
    expect(overdue.severity).toBe("bad");
    expect(overdue.message).toContain("37h");
  });

  it("leaves a match that is merely in progress alone", () => {
    const f = legFindings(
      leg({ kickoffAt: new Date("2026-11-06T08:00:00Z") }),
      "2026-11-06",
      NOW,
    );
    expect(codes(f)).not.toContain("overdue");
  });

  it("does not call a graded leg overdue", () => {
    const f = legFindings(
      leg({ kickoffAt: new Date("2026-11-04T20:00:00Z"), status: "LOST" }),
      "2026-11-04",
      NOW,
    );
    expect(codes(f)).not.toContain("overdue");
  });
});

describe("the slip as a whole", () => {
  const slip = (over: Partial<SlipUnderReview> = {}): SlipUnderReview => ({
    forDate: "2026-11-06",
    combinedOdds: 2.0,
    status: "PENDING",
    publishedAt: new Date("2026-11-06T07:01:00Z"),
    lastVerifiedAt: new Date("2026-11-06T08:30:00Z"),
    legs: [leg(), leg({ position: 2 })],
    ...over,
  });

  it("is quiet about a slip with nothing wrong with it", () => {
    expect(slipFindings(slip(), NOW, SHAPE)).toEqual([]);
  });

  it("notices a slip priced outside its own band", () => {
    expect(codes(slipFindings(slip({ combinedOdds: 1.6 }), NOW, SHAPE))).toContain("off-band");
    expect(codes(slipFindings(slip({ combinedOdds: 2.1 }), NOW, SHAPE))).not.toContain("off-band");
  });

  it("notices a slip with the wrong number of selections", () => {
    expect(codes(slipFindings(slip({ legs: [leg()] }), NOW, SHAPE))).toContain("leg-count");
  });

  /**
   * The symptom of a rollup that never ran is a slip that stays open for ever on the public
   * record while every leg beneath it has a result. Nothing errors, so nothing else would say so.
   */
  it("notices a slip still open when every leg is graded", () => {
    const f = slipFindings(slip({ legs: [leg({ status: "WON" }), leg({ position: 2, status: "LOST" })] }), NOW, SHAPE);
    expect(codes(f)).toContain("rollup-pending");
  });

  it("notices a slip of entirely void legs that is not itself void", () => {
    const f = slipFindings(
      slip({ status: "LOST", legs: [leg({ status: "VOID" }), leg({ position: 2, status: "VOID" })] }),
      NOW,
      SHAPE,
    );
    expect(codes(f)).toContain("all-void");
  });

  it("notices a slip published hours ago and never verified since", () => {
    const f = slipFindings(
      slip({ lastVerifiedAt: null }),
      new Date("2026-11-06T20:00:00Z"),
      SHAPE,
    );
    expect(codes(f)).toContain("never-verified");
  });

  it("says a slip with no selections has none, and stops there", () => {
    expect(codes(slipFindings(slip({ legs: [] }), NOW, SHAPE))).toEqual(["no-legs"]);
  });
});

describe("ordering, so the worst thing is the first thing read", () => {
  it("ranks bad above warn above info", () => {
    expect(worst([{ code: "a", severity: "info", message: "" }, { code: "b", severity: "bad", message: "" }])).toBe("bad");
    expect(worst([{ code: "a", severity: "info", message: "" }, { code: "b", severity: "warn", message: "" }])).toBe("warn");
    expect(worst([])).toBeNull();
  });

  it("sorts findings worst first", () => {
    const sorted = bySeverity([
      { code: "note", severity: "info", message: "" },
      { code: "check", severity: "warn", message: "" },
      { code: "fault", severity: "bad", message: "" },
    ]);
    expect(codes(sorted)).toEqual(["fault", "check", "note"]);
  });
});
