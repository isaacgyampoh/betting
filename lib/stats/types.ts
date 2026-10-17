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
  /**
   * Team statistics, home side first. Empty when the competition carries none - which the
   * `coverage.statistics` flag distinguishes from a match where nothing has happened yet.
   */
  statistics: TeamStatistics[];
  /** Line-ups, home side first. Empty when the competition carries none. */
  lineups: Lineup[];
  /** Sections the stats provider's plan doesn't include (shown as a note, never faked). */
  unavailable: ("form" | "h2h" | "standings" | "events" | "statistics" | "lineups")[];
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

/**
 * One side's team statistics for a match, as the provider reports them.
 *
 * Every field is nullable and every null means "not reported", never zero. The provider returns
 * explicit nulls for counts it does not have, and a competition with no statistics coverage at all
 * returns an empty array - which is indistinguishable from "nothing happened" without the coverage
 * flag, and is why `LeagueCoverage.statistics` travels alongside.
 *
 * Possession arrives as a string like "33%" and expected goals as a string like "1.24"; both are
 * parsed here so the client never has to, and both stay null when absent rather than becoming 0.
 */
export type TeamStatistics = {
  team: TeamRef;
  /** Percentage of the ball, 0-100. */
  possession: number | null;
  shotsTotal: number | null;
  shotsOnGoal: number | null;
  shotsOffGoal: number | null;
  shotsBlocked: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  corners: number | null;
  offsides: number | null;
  fouls: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  /** Expected goals, when the competition carries them. Absent on most. */
  expectedGoals: number | null;
};

export type LineupPlayer = {
  id: number | null;
  name: string;
  /** Shirt number, when reported. */
  number: number | null;
  /** The provider's position letter: G, D, M, F. */
  position: string | null;
  /**
   * Where the provider places the player, as "row:column" counting from the goalkeeper. Null for
   * substitutes and for competitions that report a lineup without positions - a pitch view must
   * handle that rather than guess a formation.
   */
  grid: string | null;
};

export type Lineup = {
  team: TeamRef;
  /** e.g. "4-2-3-1". Null when the provider does not say. */
  formation: string | null;
  coach: string | null;
  startXI: LineupPlayer[];
  substitutes: LineupPlayer[];
};

/** A club or national side, beyond the id and crest a fixture carries. */
export type TeamProfile = {
  id: number;
  name: string;
  logo: string | null;
  /** Three-letter code, when the provider has one. */
  code: string | null;
  country: string | null;
  founded: number | null;
  /** True for a national team, which has no league table or squad in the club sense. */
  national: boolean;
  venue: { name: string | null; city: string | null; capacity: number | null } | null;
};

export type SquadPlayer = {
  id: number | null;
  name: string;
  number: number | null;
  /** Goalkeeper, Defender, Midfielder, Attacker - the provider's own wording. */
  position: string | null;
  age: number | null;
  photo: string | null;
};

/** A competition in the catalogue, with what its current season actually carries. */
export type CompetitionSummary = {
  id: number;
  name: string;
  country: string;
  logo: string | null;
  flag: string | null;
  /** "League" or "Cup". A cup has no table, which is why a competition page must know. */
  type: string;
  season: number | null;
  coverage: LeagueCoverage | null;
};

export interface StatsProvider {
  readonly source: StatsSource;
  fixturesByDate(date: string): Promise<MatchSummary[]>; // YYYY-MM-DD (UTC)
  fixture(id: number): Promise<MatchSummary | null>;
  lastFixtures(teamId: number, count: number): Promise<MatchSummary[]>;
  headToHead(homeId: number, awayId: number, count: number): Promise<MatchSummary[]>;
  standings(leagueId: number, season: number): Promise<StandingRow[] | null>;
  /** Goals, cards and substitutions in order. Empty when the competition does not carry them. */
  /**
   * @param settled true once the match is over and its data cannot change again, which is what
   *   lets it be cached for a day instead of two minutes.
   */
  events(fixtureId: number, homeTeamId: number, settled?: boolean): Promise<MatchEvent[]>;
  /** What this competition's season actually includes. Null when the provider does not say. */
  coverage(leagueId: number, season: number): Promise<LeagueCoverage | null>;
  /** Team statistics, home side first. Empty when the competition does not carry them. */
  statistics(fixtureId: number, homeTeamId: number, settled?: boolean): Promise<TeamStatistics[]>;
  /** Line-ups, home side first. Empty when the competition does not carry them. */
  lineups(fixtureId: number, homeTeamId: number, settled?: boolean): Promise<Lineup[]>;
  /** A team's own details. Null when the provider does not know the id. */
  team(teamId: number): Promise<TeamProfile | null>;
  /** A team's next fixtures, soonest first. */
  upcomingFixtures(teamId: number, count: number): Promise<MatchSummary[]>;
  /** A team's current squad. Empty for a competition or side the provider does not carry one for. */
  squad(teamId: number): Promise<SquadPlayer[]>;
  /** Every competition the provider's plan exposes, with each one's coverage. */
  competitions(): Promise<CompetitionSummary[]>;
}
