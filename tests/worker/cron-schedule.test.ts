import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The schedule has to overlap the window the jobs actually look at.
 *
 * This is not a test about cron syntax. It is about a bug that no unit test could have caught,
 * because every function involved was correct on its own:
 *
 *   - `refreshSpecialOdds` re-reads prices for picks that have **not kicked off** (`kickoffAt > now`).
 *   - The day's picks are published by the 07:00 trigger.
 *   - The only other trigger ran at 03:30.
 *
 * At 03:30 the day's picks do not exist yet, and by the next 03:30 they have been played. So the one
 * run that could refresh a price never matched a single row. `lastVerifiedAt` stayed at publication
 * time for ever and the "price moved" indicator could not fire - while the code, the query and the
 * cron were each individually fine. The defect lived in the gap between them, which is exactly the
 * kind nothing notices until someone reads a published slip and asks when the price was last checked.
 *
 * So the invariant is asserted on the schedule itself: there must be a settle/refresh run that
 * happens after the day's picks are published and before they kick off.
 */

const HOUR_OF = (cron: string) => {
  const [minute, hour] = cron.split(" ");
  return Number(hour) + Number(minute) / 60;
};

function crons(): string[] {
  // wrangler.jsonc has comments, so it is not JSON.parse-able as-is.
  const raw = readFileSync("wrangler.jsonc", "utf8");
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const m = /"crons"\s*:\s*\[([^\]]*)\]/.exec(stripped);
  if (!m) throw new Error("no crons array found in wrangler.jsonc");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** worker.ts: the 07:00 trigger publishes, everything else is the settle/refresh job. */
const PUBLISH_CRON = "0 7 * * *";
const routeFor = (cron: string) => (cron === PUBLISH_CRON ? "/cron/daily-picks" : "/cron/cleanup");

/**
 * The earliest kick-off a published slip realistically carries. Ghana is UTC, and the fixtures
 * these slips are built from are afternoon and evening games; 17:00 is a deliberately conservative
 * floor, so a refresh scheduled before it is genuinely looking at upcoming matches.
 */
const EARLIEST_KICKOFF_HOUR = 17;

describe("the cron schedule", () => {
  const schedule = crons();

  it("still publishes once a day", () => {
    expect(schedule).toContain(PUBLISH_CRON);
    expect(schedule.filter((c) => routeFor(c) === "/cron/daily-picks")).toHaveLength(1);
  });

  it("settles overnight, before the day's picks are published", () => {
    const settles = schedule.filter((c) => routeFor(c) === "/cron/cleanup");
    expect(settles.some((c) => HOUR_OF(c) < HOUR_OF(PUBLISH_CRON))).toBe(true);
  });

  // The regression. Without a run in this window, refreshSpecialOdds has nothing it can ever match.
  it("re-reads prices while the day's fixtures are still upcoming", () => {
    const window = schedule
      .filter((c) => routeFor(c) === "/cron/cleanup")
      .filter((c) => HOUR_OF(c) > HOUR_OF(PUBLISH_CRON) && HOUR_OF(c) < EARLIEST_KICKOFF_HOUR);

    expect(
      window,
      "no cleanup run falls between publication and kick-off, so refreshSpecialOdds can never " +
        "match a pick: at that point the day's picks either do not exist yet or have been played",
    ).not.toHaveLength(0);
  });

  it("stays inside the three triggers a Workers plan affords without asking", () => {
    // Not a hard platform truth so much as a budget: more triggers is a deliberate decision, and a
    // schedule that silently grows is how a job ends up running more often than anyone intended.
    expect(schedule.length).toBeLessThanOrEqual(3);
  });

  it("uses only minute/hour schedules, so the hour arithmetic above is meaningful", () => {
    for (const c of schedule) {
      const parts = c.split(" ");
      expect(parts, c).toHaveLength(5);
      expect(parts[0], `${c}: minute must be fixed`).toMatch(/^\d+$/);
      expect(parts[1], `${c}: hour must be fixed`).toMatch(/^\d+$/);
      expect(parts.slice(2).join(" "), `${c}: must be daily`).toBe("* * *");
    }
  });
});
