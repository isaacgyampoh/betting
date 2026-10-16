import { FIXTURES, mockKickoff } from "@/lib/bookmakers/mock/fixtures";
import type { MatchSummary, StandingRow, StatsProvider, TeamRef } from "@/lib/stats/types";

// Deterministic SAMPLE stats for development without an API-Football key. Every response is
// tagged source "sample" and the UI labels it; nothing here is presented as real data.

const LEAGUES: Record<string, { id: number; name: string; country: string }> = {
  "England|Premier League": { id: 39, name: "Premier League", country: "England" },
  "Spain|LaLiga": { id: 140, name: "La Liga", country: "Spain" },
  "Italy|Serie A": { id: 135, name: "Serie A", country: "Italy" },
  "Ghana|Premier League": { id: 570, name: "Premier League", country: "Ghana" },
};

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const goals = (r: () => number, strength: number) => Math.min(5, Math.floor(-Math.log(1 - r()) * strength));

type SampleFixture = { id: number; kickoffAt: Date; league: (typeof LEAGUES)[string]; home: TeamRef; away: TeamRef };

function team(name: string): TeamRef {
  return { id: 1000 + (hash(name) % 90000), name, logo: null };
}

function upcoming(now = new Date()): SampleFixture[] {
  return FIXTURES.map((f) => {
    const [home, away] = f.names.sportybet ?? f.names.betway!;
    return {
      id: 5_000_000 + (hash(f.key) % 1_000_000),
      kickoffAt: mockKickoff(f.kickoffOffsetMin, now),
      league: LEAGUES[`${f.country}|${f.competition}`],
      home: team(home),
      away: team(away),
    };
  });
}

function leagueTeams(leagueId: number): TeamRef[] {
  const seen = new Map<number, TeamRef>();
  for (const f of upcoming()) {
    if (f.league.id !== leagueId) continue;
    seen.set(f.home.id, f.home);
    seen.set(f.away.id, f.away);
  }
  return [...seen.values()];
}

function leagueOf(teamId: number) {
  return upcoming().find((f) => f.home.id === teamId || f.away.id === teamId)?.league;
}

function summary(f: SampleFixture, now: Date, score?: [number, number]): MatchSummary {
  const started = f.kickoffAt <= now;
  const season = f.kickoffAt.getUTCMonth() >= 6 ? f.kickoffAt.getUTCFullYear() : f.kickoffAt.getUTCFullYear() - 1;
  return {
    id: f.id,
    kickoffAt: f.kickoffAt.toISOString(),
    status: score ? "FINISHED" : started ? "LIVE" : "SCHEDULED",
    statusLabel: score ? "Match Finished" : started ? "In play" : "Not Started",
    league: { ...f.league, season, logo: null },
    home: f.home,
    away: f.away,
    goals: score ? { home: score[0], away: score[1] } : started ? { home: 0, away: 0 } : { home: null, away: null },
  };
}

function pastMatch(a: TeamRef, b: TeamRef, daysAgo: number, league: (typeof LEAGUES)[string], seed: string): MatchSummary {
  const r = rng(hash(seed));
  const homeFirst = r() < 0.5;
  const [home, away] = homeFirst ? [a, b] : [b, a];
  const kickoffAt = new Date(Date.now() - daysAgo * 86_400_000);
  kickoffAt.setUTCHours(15, 0, 0, 0);
  const f: SampleFixture = { id: 6_000_000 + (hash(seed) % 1_000_000), kickoffAt, league, home, away };
  return summary(f, new Date(), [goals(r, 1.5), goals(r, 1.1)]);
}

export const sampleStatsProvider: StatsProvider = {
  source: "sample",
  async fixturesByDate(date) {
    const now = new Date();
    return upcoming(now)
      .filter((f) => f.kickoffAt.toISOString().slice(0, 10) === date)
      .map((f) => summary(f, now));
  },
  async fixture(id) {
    const now = new Date();
    const f = upcoming(now).find((x) => x.id === id);
    return f ? summary(f, now) : null;
  },
  async lastFixtures(teamId, count) {
    const league = leagueOf(teamId);
    if (!league) return [];
    const self = leagueTeams(league.id).find((t) => t.id === teamId)!;
    const rivals = ["Rovers", "Athletic", "City", "United", "Stars", "Wanderers", "Town", "Rangers"].map((s) => team(`${league.country} ${s}`));
    return Array.from({ length: count }, (_, i) => pastMatch(self, rivals[(teamId + i) % rivals.length], 7 * (i + 1), league, `${teamId}:last:${i}`));
  },
  async headToHead(homeId, awayId, count) {
    const league = leagueOf(homeId);
    const teams = league ? leagueTeams(league.id) : [];
    const a = teams.find((t) => t.id === homeId);
    const b = teams.find((t) => t.id === awayId);
    if (!a || !b || !league) return [];
    const [x, y] = [homeId, awayId].sort((p, q) => p - q);
    return Array.from({ length: count }, (_, i) => pastMatch(a, b, 180 * (i + 1), league, `${x}-${y}:h2h:${i}`));
  },
  // The sample set carries a short timeline and full coverage, so tests exercise the same shapes
  // the live provider returns rather than only the empty case.
  // Arguments ignored on purpose: one fixed timeline, so tests are deterministic.
  async events() {
    return [
      { minute: 23, extra: null, side: "HOME" as const, type: "GOAL" as const, player: "Marcus Rashford", other: "Bruno Fernandes", detail: "Normal Goal" },
      { minute: 58, extra: null, side: "AWAY" as const, type: "YELLOW" as const, player: "Cristian Romero", other: null, detail: "Yellow Card" },
      { minute: 71, extra: null, side: "AWAY" as const, type: "GOAL" as const, player: "Son Heung-Min", other: null, detail: "Normal Goal" },
      { minute: 90, extra: 3, side: "HOME" as const, type: "SUBSTITUTION" as const, player: "Antony", other: "Alejandro Garnacho", detail: "Substitution 3" },
    ];
  },
  async coverage() {
    return { events: true, lineups: true, statistics: true, playerStats: true, standings: true };
  },
  async team(teamId: number) {
    const found = Object.values(LEAGUES).flatMap((l) => leagueTeams(l.id)).find((t) => t.id === teamId);
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      logo: found.logo,
      code: found.name.slice(0, 3).toUpperCase(),
      country: "Sample",
      founded: 1900,
      national: false,
      venue: { name: `${found.name} Stadium`, city: "Sample City", capacity: 30000 },
    };
  },
  async upcomingFixtures(teamId: number, count: number) {
    const league = Object.values(LEAGUES)[0];
    const teams = leagueTeams(league.id);
    const self = teams.find((t) => t.id === teamId) ?? teams[0];
    const others = teams.filter((t) => t.id !== self.id);
    return Array.from({ length: count }, (_, i) =>
      pastMatch(self, others[i % others.length], -7 * (i + 1), league, `${self.id}:next:${i}`),
    );
  },
  // Deliberately empty: the live provider returns no squad for plenty of sides, and anything
  // downstream has to treat that as absent rather than as a team with no players.
  async squad() {
    return [];
  },
  async competitions() {
    return Object.values(LEAGUES).map((l) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      logo: null,
      flag: null,
      type: "League",
      season: 2026,
      coverage: { events: true, lineups: true, statistics: true, playerStats: true, standings: true },
    }));
  },
  // One fixed set, so tests are deterministic. Deliberately includes a null: the live provider
  // sends explicit nulls for counts it does not have, and anything downstream that turns those
  // into zeros is claiming something did not happen when it is simply unknown.
  async statistics(_fixtureId: number, homeTeamId: number) {
    const side = (id: number, possession: number, shots: number, xg: number | null) => ({
      team: { id, name: `Team ${id}`, logo: null },
      possession,
      shotsTotal: shots,
      shotsOnGoal: Math.max(0, shots - 4),
      shotsOffGoal: 3,
      shotsBlocked: 1,
      shotsInsideBox: Math.max(0, shots - 3),
      shotsOutsideBox: 3,
      corners: 5,
      offsides: 2,
      fouls: 9,
      yellowCards: 1,
      redCards: 0,
      saves: 3,
      passesTotal: 420,
      passesAccurate: 360,
      expectedGoals: xg,
    });
    return [side(homeTeamId, 58, 14, 1.8), side(homeTeamId + 1, 42, 9, null)];
  },
  async lineups(_fixtureId: number, homeTeamId: number) {
    const eleven = (prefix: string) =>
      Array.from({ length: 11 }, (_, i) => ({
        id: null,
        name: `${prefix} Player ${i + 1}`,
        number: i + 1,
        position: i === 0 ? "G" : i < 5 ? "D" : i < 9 ? "M" : "F",
        grid: i === 0 ? "1:1" : `${Math.min(4, Math.floor((i - 1) / 4) + 2)}:${((i - 1) % 4) + 1}`,
      }));
    return [
      {
        team: { id: homeTeamId, name: `Team ${homeTeamId}`, logo: null },
        formation: "4-4-2",
        coach: "Sample Coach",
        startXI: eleven("Home"),
        substitutes: [],
      },
      {
        team: { id: homeTeamId + 1, name: `Team ${homeTeamId + 1}`, logo: null },
        formation: "4-3-3",
        coach: "Other Coach",
        startXI: eleven("Away"),
        substitutes: [],
      },
    ];
  },
  async standings(leagueId) {
    const teams = leagueTeams(leagueId);
    const fillers = ["Rovers", "Athletic", "City", "United", "Stars", "Wanderers"].map((s) => team(`${Object.values(LEAGUES).find((l) => l.id === leagueId)?.country ?? "Sample"} ${s}`));
    const rows: StandingRow[] = [...teams, ...fillers].map((t) => {
      const r = rng(hash(`${leagueId}:${t.id}`));
      const played = 6;
      const won = Math.floor(r() * 5);
      const drawn = Math.floor(r() * (played - won + 1));
      const lost = played - won - drawn;
      const gf = won * 2 + drawn + Math.floor(r() * 3);
      const ga = lost * 2 + drawn + Math.floor(r() * 3);
      return { rank: 0, team: t, played, won, drawn, lost, goalsFor: gf, goalsAgainst: ga, points: won * 3 + drawn, form: null };
    });
    rows.sort((p, q) => q.points - p.points || q.goalsFor - q.goalsAgainst - (p.goalsFor - p.goalsAgainst) || p.team.name.localeCompare(q.team.name));
    return rows.map((row, i) => ({ ...row, rank: i + 1 }));
  },
};
