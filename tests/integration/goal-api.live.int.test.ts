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

  it("reports the panels it cannot supply as empty rather than inventing them", async () => {
    const { createGoalApiProvider } = await import("@/lib/stats/goal-api");
    const provider = createGoalApiProvider(process.env.GOAL_API_KEY!);
    // Honest absence, which the match page turns into a stated note. If these ever start
    // returning data, the mapping has been written and this test should be replaced, not deleted.
    expect(await provider.statistics(1, 1)).toEqual([]);
    expect(await provider.lineups(1, 1)).toEqual([]);
    expect(await provider.coverage(1, 2026)).toBeNull();
  }, 60_000);
});
