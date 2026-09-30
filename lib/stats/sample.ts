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
