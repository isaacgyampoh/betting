import { describe, expect, it } from "vitest";
import { listedGroups } from "@/lib/services/stats";

/**
 * A match being played right now must be reachable in Live Centre.
 *
 * The day's list is capped at 150 fixtures, taken as whole leagues in priority order. That cap is
 * sensible - 1,306 fixtures on an ordinary Sunday is not a list anyone scrolls - but it was
 * computed over the whole day with no idea which matches were in play. So the slots filled with
 * big-league fixtures that had not kicked off, and a live match in a lower-ranked league was cut
 * before the app ever got to filter for "live".
 *
 * That is the "matches are missing" report: not a synchronisation failure, a ranking that ignored
 * what the user had opened the screen to see.
 */

const leagues = {
  epl: { id: 39, name: "Premier League", country: "England", season: 2026, logo: null },
  liga: { id: 140, name: "La Liga", country: "Spain", season: 2026, logo: null },
  seriea: { id: 135, name: "Serie A", country: "Italy", season: 2026, logo: null },
  small: { id: 9001, name: "Second Division", country: "Algeria", season: 2026, logo: null },
};

type L = (typeof leagues)[keyof typeof leagues];

function match(id: number, league: L, status: "SCHEDULED" | "LIVE" | "FINISHED") {
  return {
    id,
    kickoffAt: "2026-10-18T15:00:00.000Z",
    status,
    statusLabel: status === "LIVE" ? "55'" : "Not Started",
    league,
    home: { id: id * 10, name: `Home ${id}`, logo: null },
    away: { id: id * 10 + 1, name: `Away ${id}`, logo: null },
    goals: { home: null, away: null },
  };
}

/** A day heavy enough to exhaust the cap on scheduled fixtures alone. */
function busyDay() {
  const fixtures = [];
  let id = 1;
  // 160 fixtures across two top leagues, none of them started.
  for (let i = 0; i < 80; i++) fixtures.push(match(id++, leagues.epl, "SCHEDULED"));
  for (let i = 0; i < 80; i++) fixtures.push(match(id++, leagues.liga, "SCHEDULED"));
  for (let i = 0; i < 80; i++) fixtures.push(match(id++, leagues.seriea, "SCHEDULED"));
  // Two matches actually being played, in a league nobody ranked.
  fixtures.push(match(900, leagues.small, "LIVE"));
  fixtures.push(match(901, leagues.small, "LIVE"));
  return fixtures;
}

const listWith = (fixtures: unknown[]) => listedGroups(fixtures as never, 150);

describe("a live match is never cut by the day's cap", () => {
  it("lists the live fixtures even when the cap is already full of scheduled ones", () => {
    const groups = listWith(busyDay());
    const listed = groups.flatMap((g) => g.matches);
    const live = listed.filter((m) => m.status === "LIVE");

    expect(live.map((m) => m.id).sort(), "both live matches must be reachable").toEqual([900, 901]);
  });

  it("still applies the cap to the leagues that are not live", () => {
    // Three 80-fixture leagues plus two live ones is 242. The cap stops adding leagues once it is
    // reached, so the third big league is left out - but it never truncates a league mid-table,
    // which is why the total can sit above 150 rather than exactly on it.
    const groups = listWith(busyDay());
    const shown = groups.reduce((n, g) => n + g.matches.length, 0);
    expect(shown).toBeLessThan(242);
    expect(groups.map((g) => g.league.name)).not.toContain("Serie A");
  });

  it("does not promote a live minor league above the Premier League", () => {
    // Protected from the cap, not moved to the top: the order a user knows stays the order.
    const groups = listWith(busyDay());
    const names = groups.map((g) => g.league.name);
    expect(names.indexOf("Premier League")).toBeLessThan(names.indexOf("Second Division"));
  });

  it("keeps whole leagues together rather than half a table", () => {
    // Half a league's fixtures reads as missing games rather than as a shorter list.
    const groups = listWith(busyDay());
    for (const g of groups) {
      const all = busyDay().filter((m) => m.league.id === g.league.id);
      expect(g.matches.length, `${g.league.name} was split`).toBe(all.length);
    }
  });

  it("does not pad a quiet day", () => {
    const quiet = [match(1, leagues.epl, "SCHEDULED"), match(2, leagues.small, "LIVE")];
    expect(listWith(quiet).flatMap((g) => g.matches)).toHaveLength(2);
  });
});
