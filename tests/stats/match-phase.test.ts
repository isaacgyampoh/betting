import { describe, expect, it } from "vitest";
import { toMatchSummary } from "@/lib/stats/api-football";

/**
 * What the badge on a fixture row is allowed to say.
 *
 * The reported symptom was a match showing minute 35 while another site showed half time, and a
 * match showing 89' long after full time. Both come from one expression: a running minute was
 * printed for *every* status that mapped to LIVE, and the provider maps nine different short codes
 * to that - including HT (half time), BT (break in extra time), P (penalties), SUSP (suspended)
 * and INT (interrupted).
 *
 * So a halted match was displayed as a running one, and the number shown was the minute play
 * stopped at. There is no clock in the app - it renders whatever the server sends - which is why
 * the minute looked frozen rather than wrong.
 *
 * The rule these tests hold: a minute is shown only while the ball is actually in play. Every
 * other phase says what it is.
 */

/** A fixture shaped the way api-football sends one. */
function fixture(short: string, long: string, elapsed: number | null) {
  return {
    fixture: { id: 1, date: "2026-10-18T15:00:00+00:00", status: { short, long, elapsed } },
    league: { id: 39, name: "Premier League", country: "England", season: 2026, logo: null },
    teams: { home: { id: 1, name: "Arsenal", logo: null }, away: { id: 2, name: "Chelsea", logo: null } },
    goals: { home: 1, away: 0 },
    score: { halftime: { home: 1, away: 0 } },
  } as never;
}

describe("the minute is only shown while the ball is in play", () => {
  it("says half time rather than a minute", () => {
    // The reported bug. The provider sends elapsed=45 at half time, and printing it produced a
    // row that read exactly like a match in its 45th minute.
    const m = toMatchSummary(fixture("HT", "Halftime", 45));
    expect(m.statusLabel).not.toBe("45'");
    expect(m.statusLabel.toLowerCase()).toContain("half");
  });

  it("says the match is suspended rather than showing a ticking minute", () => {
    // The worst of the set: a match stopped by the referee, displayed as if play continued.
    const m = toMatchSummary(fixture("SUSP", "Match Suspended", 63));
    expect(m.statusLabel).not.toBe("63'");
    expect(m.statusLabel.toLowerCase()).toContain("suspend");
  });

  it("says the match is interrupted rather than showing a ticking minute", () => {
    const m = toMatchSummary(fixture("INT", "Match Interrupted", 70));
    expect(m.statusLabel).not.toBe("70'");
    expect(m.statusLabel.toLowerCase()).toContain("interrupt");
  });

  it("names the break before extra time", () => {
    const m = toMatchSummary(fixture("BT", "Break Time", 90));
    expect(m.statusLabel).not.toBe("90'");
  });

  it("names penalties rather than a minute", () => {
    // A shoot-out has no match minute at all; 120 would be a lie about what is happening.
    const m = toMatchSummary(fixture("P", "Penalty In Progress", 120));
    expect(m.statusLabel).not.toBe("120'");
    expect(m.statusLabel.toLowerCase()).toContain("penal");
  });

  describe("phases where a minute is the right thing to show", () => {
    it("shows the minute in the first half", () => {
      expect(toMatchSummary(fixture("1H", "First Half", 35)).statusLabel).toBe("35'");
    });

    it("shows the minute in the second half", () => {
      expect(toMatchSummary(fixture("2H", "Second Half", 67)).statusLabel).toBe("67'");
    });

    it("shows the minute in extra time", () => {
      expect(toMatchSummary(fixture("ET", "Extra Time", 105)).statusLabel).toBe("105'");
    });
  });

  describe("phases that are not live at all", () => {
    it("says full time", () => {
      const m = toMatchSummary(fixture("FT", "Match Finished", 90));
      expect(m.status).toBe("FINISHED");
      expect(m.statusLabel).not.toBe("90'");
    });

    it("keeps a finished-after-extra-time match finished", () => {
      expect(toMatchSummary(fixture("AET", "Match Finished After Extra Time", 120)).status).toBe(
        "FINISHED",
      );
    });

    it("keeps a shoot-out result finished", () => {
      expect(toMatchSummary(fixture("PEN", "Match Finished After Penalty", 120)).status).toBe(
        "FINISHED",
      );
    });

    it("says not started", () => {
      const m = toMatchSummary(fixture("NS", "Not Started", null));
      expect(m.status).toBe("SCHEDULED");
      expect(m.statusLabel).toBe("Not Started");
    });

    it("keeps an abandoned match out of the finished pile", () => {
      // Abandoned is not a result. Treating it as finished would put a half-played match in
      // Results with a score that was never final.
      expect(toMatchSummary(fixture("ABD", "Match Abandoned", 55)).status).not.toBe("FINISHED");
    });
  });

  it("never shows an empty badge when the provider gives no minute", () => {
    // elapsed is null early in a half and on some feeds. The row still has to say something.
    const m = toMatchSummary(fixture("1H", "First Half", null));
    expect(m.statusLabel.trim()).not.toBe("");
  });

  it("does not show 0' when the provider reports the opening minute", () => {
    // `elapsed && ...` treated 0 as absent, so the first minute of a match fell through to the
    // long label. Harmless-looking, but it is the same class of bug as the rest of this file.
    const m = toMatchSummary(fixture("1H", "First Half", 0));
    expect(m.status).toBe("LIVE");
  });
});
