import { describe, expect, it, vi } from "vitest";

/**
 * The GOAL API provider against the real service, with a real key.
 *
 * Off unless GOAL_LIVE=1, for the reason the Worker's live test is off by default: a suite that
 * goes red when a third party is slow teaches people to ignore red. Run it before trusting a
 * change to lib/stats/goal-api.ts, and after switching STATS_PROVIDER:
 *
 *   GOAL_LIVE=1 GOAL_API_KEY=… TEST_DATABASE_URL=… pnpm test:int goal-api.live
 *
 * It asserts the mapping rather than the provider's uptime - that statuses are translated, that a
 * live match is not reported as finished, that ids come out numeric and round-trip through the
 * cuid map, and that a day's list is the whole day rather than one page.
 */
const live = process.env.GOAL_LIVE === "1" && !!process.env.GOAL_API_KEY;

describe.skipIf(!live)("GOAL API, live", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("returns a whole day, not a single page", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);

    const day = await provider.fixturesByDate(today);
    // One page is 100 and a real day is about 1,150, so anything near 100 means pagination broke.
    expect(day.length).toBeGreaterThan(150);
    expect(provider.source).toBe("goal-api");
  }, 120_000);

  it("maps every fixture to a shape the rest of the app can use", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const day = await createGoalApiProvider(process.env.GOAL_API_KEY!).fixturesByDate(today);

    for (const m of day) {
      expect(Number.isInteger(m.id), `id ${m.id} must be an integer`).toBe(true);
      expect(m.id).toBeGreaterThan(0);
      // An unparseable kickoff is the failure that silently empties a day's list, because every
      // consumer buckets by date.
      expect(new Date(m.kickoffAt).toString()).not.toBe("Invalid Date");
      expect(["SCHEDULED", "LIVE", "FINISHED", "POSTPONED", "CANCELLED"]).toContain(m.status);
      expect(m.home.name.length, `fixture ${m.id} has no home team name`).toBeGreaterThan(0);
      expect(m.away.name.length).toBeGreaterThan(0);
      expect(Number.isInteger(m.league.season)).toBe(true);
    }
  }, 120_000);

  // The one that matters most. Across a real day, 17 fixtures were FINISHED while still carrying
  // matchLive=1, and one was SCHEDULED with matchPeriod=HALF_TIME. Trusting the live flag would
  // show finished games as in play.
  it("never reports a finished match as live, or a live one as finished", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const day = await createGoalApiProvider(process.env.GOAL_API_KEY!).fixturesByDate(today);

    for (const m of day) {
      if (m.status === "FINISHED") {
        expect(m.statusLabel, `finished ${m.id} labelled ${m.statusLabel}`).toBe("FT");
      }
      if (m.status === "LIVE") {
        expect(m.statusLabel).not.toBe("FT");
      }
      // A finished match with no score at all is either mis-mapped or not actually finished.
      if (m.status === "FINISHED" && m.goals.home === null && m.goals.away === null) {
        throw new Error(`fixture ${m.id} is FINISHED with no score`);
      }
    }
  }, 120_000);

  it("fetches one fixture by the numeric id it handed out", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);
    const day = await provider.fixturesByDate(today);
    const one = day[0];

    const again = await provider.fixture(one.id);
    expect(again, `fixture(${one.id}) came back null`).not.toBeNull();
    expect(again!.id).toBe(one.id);
    expect(again!.home.name).toBe(one.home.name);
  }, 120_000);

  // The cuid map is what makes a numeric team id usable again. It is populated by reading the day,
  // so this has to run after it - which is also true in production, where nothing can be opened
  // before the list it was opened from.
  it("resolves a team's recent results through the remembered cuid", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);
    const day = await provider.fixturesByDate(today);
    const withId = day.find((m) => m.home.id > 0);
    expect(withId, "no fixture carried a numeric home team id").toBeDefined();

    const recent = await provider.lastFixtures(withId!.home.id, 5);
    // Not asserted non-empty: a newly promoted side genuinely has no results in the window. What
    // is asserted is that whatever comes back is well formed, because the dangerous failure here
    // is GOAL answering 200 with an empty list for an id of the wrong kind.
    for (const m of recent) {
      expect(Number.isInteger(m.id)).toBe(true);
      expect(m.status).toBe("FINISHED");
    }
  }, 120_000);

  /**
   * Whether a daily pick can still be evidenced under GOAL API.
   *
   * This is the question behind the whole switch, and it is not answered by the provider methods
   * passing individually. A published pick needs `lookupMatch` to find the stats provider's copy
   * of a fixture the *bookmaker* named - matched on team names and kick-off, across two sources
   * that spell teams differently ("Lanús" against "Lanus") - and then `getMatchDetail` to return
   * recent form behind it. Without both, `withConviction` drops every candidate and the 07:00 job
   * publishes nothing, which is exactly what happened on 1 November.
   *
   * So this drives the real service functions, not the provider, and reports what each section
   * actually returned rather than asserting a shape.
   */
  it("can look a fixture up by name and get form behind it, which is what a pick needs", async () => {
    const prior = { key: process.env.GOAL_API_KEY, provider: process.env.STATS_PROVIDER, mode: process.env.STATS_MODE };
    process.env.STATS_PROVIDER = "goal";
    process.env.STATS_MODE = "auto";
    vi.resetModules();

    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const { lookupMatch, getMatchDetail } = await import("@/lib/services/stats");

    // Reading the day first is what fills the cuid map, and is also what production does before
    // anything can be opened.
    const day = await createGoalApiProvider(process.env.GOAL_API_KEY!).fixturesByDate(
      new Date().toISOString().slice(0, 10),
    );
    const target = day.find((m) => m.status === "SCHEDULED" && m.home.id > 0 && m.away.id > 0);
    expect(target, "no usable fixture in today's list").toBeDefined();

    // Step one: the name-and-kick-off match a bookmaker fixture has to go through.
    const found = await lookupMatch(
      target!.home.name,
      target!.away.name,
      new Date(target!.kickoffAt),
      target!.league.name,
    );
    expect(found, `lookupMatch could not find ${target!.home.name} v ${target!.away.name}`).not.toBeNull();
    expect(found!.id).toBe(target!.id);

    // Step two: the research behind the pick. `null` is the user, as the daily-picks cron passes -
    // there is nobody to meter for background work.
    const detail = await getMatchDetail(null, found!.id);
    const got = {
      source: detail.source,
      homeFormPlayed: detail.form.home.summary.played,
      awayFormPlayed: detail.form.away.summary.played,
      h2h: detail.h2h.length,
      standings: detail.standings?.length ?? 0,
      unavailable: detail.unavailable,
    };
    console.log("    evidence available under GOAL:", JSON.stringify(got));

    expect(detail.source).toBe("goal-api");
    // The assertion that matters: at least one side has recent results. With none, every candidate
    // loses its conviction and nothing is published - a silent no-pick day.
    expect(
      got.homeFormPlayed + got.awayFormPlayed,
      "neither side had any recent form, so no pick could be evidenced",
    ).toBeGreaterThan(0);

    process.env.GOAL_API_KEY = prior.key;
    process.env.STATS_PROVIDER = prior.provider;
    process.env.STATS_MODE = prior.mode;
    vi.resetModules();
  }, 180_000);

  /**
   * The statistics and line-up panels, mapped from GOAL's own vocabulary.
   *
   * Scans a past day for a finished fixture that actually has both, because most do not -
   * `hasStatistics` and `hasLineups` are false far more often than they are true, and a test
   * written against a fixture with neither would pass while mapping nothing.
   */
  it("maps statistics and line-ups where the provider has them", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const day = await provider.fixturesByDate(yesterday);
    const finished = day.filter((m) => m.status === "FINISHED");
    expect(finished.length, "no finished fixtures to inspect").toBeGreaterThan(0);

    let stats: Awaited<ReturnType<typeof provider.statistics>> = [];
    let lineups: Awaited<ReturnType<typeof provider.lineups>> = [];
    for (const m of finished.slice(0, 25)) {
      if (!stats.length) stats = await provider.statistics(m.id, m.home.id, true);
      if (!lineups.length) lineups = await provider.lineups(m.id, m.home.id, true);
      if (stats.length && lineups.length) break;
    }

    if (stats.length) {
      expect(stats).toHaveLength(2);
      const [home, away] = stats;
      console.log(
        `    statistics: possession ${home.possession}/${away.possession}  corners ${home.corners}/${away.corners}  on target ${home.shotsOnGoal}/${away.shotsOnGoal}`,
      );
      expect(home.team.name.length).toBeGreaterThan(0);
      // Possession is a percentage, not the raw "50%" string.
      if (home.possession !== null) {
        expect(home.possession).toBeGreaterThanOrEqual(0);
        expect(home.possession).toBeLessThanOrEqual(100);
      }
      // What GOAL does not publish must be null, never 0 - the panel shows the two differently.
      for (const k of ["fouls", "yellowCards", "offsides", "saves", "passesTotal", "shotsTotal"] as const) {
        expect(home[k], `${k} should be null (not reported by this provider), not a number`).toBeNull();
      }
    } else {
      console.log("    statistics: no fixture in the sample carried any");
    }

    if (lineups.length) {
      expect(lineups).toHaveLength(2);
      const [home] = lineups;
      console.log(`    lineups: ${home.startXI.length} starting, ${home.substitutes.length} subs, coach ${home.coach}`);
      expect(home.startXI.length).toBeGreaterThan(0);
      for (const pl of home.startXI) {
        expect(pl.name.length, "a named player is the whole point of a line-up").toBeGreaterThan(0);
        // GOAL's lineupPosition reads "0" for everyone, so there is no grid to report.
        expect(pl.grid).toBeNull();
        if (pl.position !== null) expect(["G", "D", "M", "F"]).toContain(pl.position);
      }
    } else {
      console.log("    lineups: no fixture in the sample carried any");
    }

    // One or the other must have been found, or the scan is not testing anything.
    expect(stats.length + lineups.length, "neither panel was found in 25 finished fixtures").toBeGreaterThan(0);
  }, 240_000);

  /**
   * A well-covered competition, where the payload is rich and the trap lives.
   *
   * GOAL returns eleven rows for a small competition and twenty-five for a big one, and in the
   * twenty-five some labels appear twice with different values - Aston Villa v Fulham carried
   * `Ball Possession` as 9%/91% and then as 45%/55%. Reading the first published 9% possession
   * for a match that had 45%.
   *
   * Both readings sum to 100, so a "percentages add up" check would have passed. What settles it
   * is the pass count: 434 against 536 is 45%. So this compares possession against pass share,
   * which is the assertion that actually catches it.
   */
  it("takes the corrected figure when a statistic is reported twice", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);
    const TOP = new Set(["England", "Italy", "Spain", "Germany", "France"]);

    let rich: Awaited<ReturnType<typeof provider.statistics>> = [];
    for (const offsetDays of [1, 2, 3]) {
      const date = new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
      const day = await provider.fixturesByDate(date);
      for (const m of day.filter((x) => x.status === "FINISHED" && TOP.has(x.league.country))) {
        const stats = await provider.statistics(m.id, m.home.id, true);
        if (stats.length && stats[0].passesTotal !== null) { rich = stats; break; }
      }
      if (rich.length) break;
    }
    if (!rich.length) {
      console.log("    no richly-covered fixture in the window; nothing to assert");
      return;
    }

    const [home, away] = rich;
    console.log(
      `    ${home.team.name} v ${away.team.name}: possession ${home.possession}/${away.possession}  ` +
        `shots ${home.shotsTotal}/${away.shotsTotal}  fouls ${home.fouls}/${away.fouls}  ` +
        `passes ${home.passesTotal}/${away.passesTotal}  saves ${home.saves}/${away.saves}`,
    );

    // The rich tier really does carry these, so a null here means the mapping missed a label.
    for (const k of ["shotsTotal", "fouls", "offsides", "saves", "passesTotal", "passesAccurate", "shotsBlocked"] as const) {
      expect(home[k], `${k} should be mapped on a richly-covered match`).not.toBeNull();
    }

    // The duplicate-label check. Possession must agree with who actually had the ball.
    const passShare = (home.passesTotal! / (home.passesTotal! + away.passesTotal!)) * 100;
    expect(
      Math.abs(home.possession! - passShare),
      `possession ${home.possession}% disagrees with pass share ${passShare.toFixed(0)}% - ` +
        "the wrong one of the duplicated Ball Possession rows was taken",
    ).toBeLessThan(20);
  }, 300_000);

  /**
   * The live overlay, which is what lets a once-an-hour day list still be a Live Centre.
   *
   * Refreshing all 1,149 fixtures often enough to be live costs twelve requests a time and does
   * not fit a 1,000-a-day budget. `/fixtures/live` returns only the matches in play, in one
   * request, and is laid over the cached day. This checks the overlay actually lands: every
   * fixture the provider calls live must come back from fixturesByDate as LIVE, even though the
   * day underneath it may be an hour old.
   */
  it("keeps matches in play fresh over an hour-old day list", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);
    const today = new Date().toISOString().slice(0, 10);

    const res = await fetch("https://api.goal-api.com/v1/fixtures/live", {
      headers: { authorization: `Bearer ${process.env.GOAL_API_KEY}` },
    });
    const live = (((await res.json()) as { data?: { apiId: string }[] })?.data ?? []) as { apiId: string }[];
    if (!live.length) {
      console.log("    nothing in play right now; overlay not exercised");
      return;
    }

    const day = await provider.fixturesByDate(today);
    const byId = new Map(day.map((m) => [m.id, m]));
    let checked = 0;
    for (const f of live) {
      const m = byId.get(Number(f.apiId));
      if (!m) continue; // a live fixture on another date is legitimate near midnight UTC
      checked++;
      expect(
        m.status,
        `${m.home.name} v ${m.away.name} is live at the provider but reads ${m.status} in the day list`,
      ).toBe("LIVE");
      expect(m.statusLabel).not.toBe("FT");
    }
    console.log(`    ${live.length} live at the provider, ${checked} matched into today, all LIVE`);
    expect(checked, "no live fixture matched into today's list").toBeGreaterThan(0);
  }, 180_000);

  it("reports coverage as unknown, because the provider does not publish it", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);
    // Null means "the provider does not say", which is true and is not the same as "none".
    expect(await provider.coverage(1, 2026)).toBeNull();
  }, 60_000);
});
