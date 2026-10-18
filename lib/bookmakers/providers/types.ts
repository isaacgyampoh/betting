import "server-only";

/**
 * A conversion route: one way of turning a booking code at one bookmaker into a booking code at
 * another.
 *
 * GameClaw has one route today - the native one, which loads the slip through our own adapter,
 * matches each fixture and market, and books at the destination adapter. A third-party provider is
 * a *second* route, not a bookmaker: it does the whole job in one call and exposes no fixtures, no
 * markets and no mapping.
 *
 * That is why this is its own port rather than another [BookmakerAdapter]. An adapter has
 * `searchEvent`, `getEventMarkets`, `mapMarket` and `unmapMarket`, and a provider can implement
 * none of them. Forcing one into that interface would mean five methods that exist only to throw,
 * and a registry that cannot tell the difference between a bookmaker we talk to and a company that
 * talks to bookmakers for us.
 *
 * Keeping the port narrow also keeps the conversion logic provider-independent: the native route
 * stays the default, and a provider is only ever consulted for a pair it actually claims.
 */

/** One leg as a route reports it back. */
export type RouteSelection = {
  eventName: string;
  competition: string | null;
  market: string;
  selection: string;
  line: string | null;
  startDate: string | null;
  sourceOdds: number | null;
  targetOdds: number | null;
  /** The destination priced a different line than the source. A real difference, not an error. */
  lineAdjusted: boolean;
};

/** A leg that did not survive, and why. Never silently dropped. */
export type RouteUnmatched = {
  eventName: string;
  market: string;
  selection: string;
  reason: string;
  reasonText: string;
};

export type RouteResult = {
  /** The destination code the provider issued. Never synthesised, never a placeholder. */
  targetCode: string;
  expiresAt: Date | null;
  matched: RouteSelection[];
  unmatched: RouteUnmatched[];
  sourceOddsTotal: number | null;
  targetOddsTotal: number | null;
  /** Which route produced this, for logging and for telling the user where a code came from. */
  routeId: string;
};

/**
 * A bookmaker in a market, as a route addresses it.
 *
 * Country is carried separately and is not optional, because the thing that goes wrong quietly is
 * a Ghana slip converted into a Nigeria code. The brands are the same, the fixtures are not, and a
 * code that books the wrong country's prices looks entirely plausible on screen.
 */
export type RouteEndpoint = { brand: string; country: string };

export interface ConversionRoute {
  readonly id: string;
  /** False when unconfigured. An unconfigured route is a configuration state, never an error. */
  readonly configured: boolean;
  /** Whether this route claims this exact pair, country included. */
  supports(from: RouteEndpoint, to: RouteEndpoint): boolean;
  /**
   * Convert, or throw an AppError.
   *
   * Implementations must not return a `targetCode` they have not been given by the provider, and
   * must not treat a 200 with no code as a success.
   */
  convert(input: {
    from: RouteEndpoint;
    to: RouteEndpoint;
    code: string;
    /** Stable per user-intent, so a retry cannot book twice. */
    idempotencyKey: string;
  }): Promise<RouteResult>;
}
