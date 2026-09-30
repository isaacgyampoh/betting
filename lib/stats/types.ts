// Provider-neutral match stats model. Client-safe.

export type TeamRef = { id: number; name: string; logo: string | null };

export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";

export type MatchSummary = {
  id: number;
  kickoffAt: string; // ISO
  status: MatchStatus;
  statusLabel: string;
  league: { id: number; name: string; country: string; season: number; logo: string | null };
  home: TeamRef;
  away: TeamRef;
  goals: { home: number | null; away: number | null };
};

export type FormResult = "W" | "D" | "L";

export type TeamForm = {
  team: TeamRef;
  matches: { match: MatchSummary; result: FormResult; goalsFor: number; goalsAgainst: number; wasHome: boolean }[];
  summary: { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; bttsRate: number; over25Rate: number };
};

export type StandingRow = {
  rank: number;
  team: TeamRef;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string | null;
};

export type StatsSource = "api-football" | "sample";

export type MatchDetail = {
  match: MatchSummary;
  form: { home: TeamForm; away: TeamForm };
  h2h: MatchSummary[];
  standings: StandingRow[] | null;
  /** Sections the stats provider's plan doesn't include (shown as a note, never faked). */
  unavailable: ("form" | "h2h" | "standings")[];
  source: StatsSource;
};

export interface StatsProvider {
  readonly source: StatsSource;
  fixturesByDate(date: string): Promise<MatchSummary[]>; // YYYY-MM-DD (UTC)
  fixture(id: number): Promise<MatchSummary | null>;
  lastFixtures(teamId: number, count: number): Promise<MatchSummary[]>;
  headToHead(homeId: number, awayId: number, count: number): Promise<MatchSummary[]>;
  standings(leagueId: number, season: number): Promise<StandingRow[] | null>;
}
