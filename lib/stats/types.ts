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
  /**
   * The score at half time, when the provider has it - present on about 94% of finished fixtures,
   * against 16% for the shot and corner counts. It is what makes a first-half line settleable.
   */
  halftime?: { home: number | null; away: number | null } | null;
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
  /** Goals, cards and substitutions in order; empty when the competition does not carry them. */
  events: MatchEvent[];
  /** What this competition carries, so the page can say what is missing instead of showing blanks. */
  coverage: LeagueCoverage | null;
  /** Sections the stats provider's plan doesn't include (shown as a note, never faked). */
  unavailable: ("form" | "h2h" | "standings" | "events")[];
  /** Some sections hit the provider's per-minute limit; a refresh shortly will fill them. */
  busy: boolean;
  source: StatsSource;
};

/**
 * One thing that happened in a match, as the provider reports it.
 *
 * Minute and team are always present; the player can be missing on lower-coverage competitions,
 * and the timeline still reads correctly without a name.
 */
export type MatchEvent = {
  minute: number;
  /** Added time within the minute, e.g. 45+2 is { minute: 45, extra: 2 }. */
  extra: number | null;
  side: "HOME" | "AWAY";
  type: "GOAL" | "OWN_GOAL" | "PENALTY" | "PENALTY_MISSED" | "YELLOW" | "SECOND_YELLOW" | "RED" | "SUBSTITUTION" | "VAR";
  player: string | null;
  /** The assisting player for a goal, or the player coming on for a substitution. */
  other: string | null;
  /** The provider's own wording, kept for anything our types do not model. */
  detail: string;
};

/**
 * What a competition's data actually includes, read from the provider rather than assumed.
 *
 * This is the difference between an empty panel and an honest one. The Ghana Premier League carries
 * events, lineups and a table but no shot, corner or possession counts and no player ratings, so a
 * match centre that assumes those exist shows blanks on the league this product was built for.
 */
export type LeagueCoverage = {
  events: boolean;
  lineups: boolean;
  /** Possession, shots, corners, fouls - the team statistics panel. */
  statistics: boolean;
  playerStats: boolean;
  standings: boolean;
};

export interface StatsProvider {
  readonly source: StatsSource;
  fixturesByDate(date: string): Promise<MatchSummary[]>; // YYYY-MM-DD (UTC)
  fixture(id: number): Promise<MatchSummary | null>;
  lastFixtures(teamId: number, count: number): Promise<MatchSummary[]>;
  headToHead(homeId: number, awayId: number, count: number): Promise<MatchSummary[]>;
  standings(leagueId: number, season: number): Promise<StandingRow[] | null>;
  /** Goals, cards and substitutions in order. Empty when the competition does not carry them. */
  events(fixtureId: number, homeTeamId: number): Promise<MatchEvent[]>;
  /** What this competition's season actually includes. Null when the provider does not say. */
  coverage(leagueId: number, season: number): Promise<LeagueCoverage | null>;
}
