/**
 * Third-party conversion providers, and what they say they can do.
 *
 * Everything in this file is a **claim read off a public marketing page on 2026-10-18**, not a
 * verified capability. That distinction is the whole reason the file exists separately from the
 * catalogue: a provider listing sixty bookmakers is a sales page, and the only thing that moves a
 * catalogue entry to `live-verified` is a real code created and read back.
 *
 * Both providers were reachable and real when checked - Betloy's API answered 401 AUTH_REQUIRED to
 * an unauthenticated call, Convat's health endpoint answered 200 with four healthy engines - so
 * the question is commercial access, not whether the services exist.
 */

export type ProviderAccess = {
  /** What it costs to get started, exactly as published. */
  entry: string;
  /** What production use costs, where published. */
  paid: string;
  /** What has to happen before any key exists. Each of these needs the owner's decision. */
  steps: string[];
};

export type ConversionProvider = {
  id: string;
  name: string;
  site: string;
  apiDocs: string;
  /** What we observed when probing, without authenticating. */
  observed: string;
  access: ProviderAccess;
  /**
   * Operators the provider claims, as `brand` or `brand (country)`.
   *
   * Recorded because the overlap with our blocked list is the entire commercial argument. Not
   * recorded as capability: see the file comment.
   */
  claims: readonly string[];
  /** Things to check during an evaluation, written down before any money is discussed. */
  verifyFirst: readonly string[];
};

export const CONVERSION_PROVIDERS: readonly ConversionProvider[] = [
  {
    id: "convat",
    name: "Convat",
    site: "https://www.convat.io/",
    apiDocs: "https://www.convat.io/api",
    observed:
      "GET /api/health answered 200 with four engines (convert, split, merge, forecast) reporting ok and a database latency of 135ms.",
    access: {
      entry: "30-day evaluation with free credits on live bookmakers, after a signed evaluation agreement.",
      paid: "Prepaid monthly plans priced by conversion volume; the figure is quoted after an access request. One credit per conversion that returns a destination code; failures, previews and retries are free.",
      steps: [
        "Submit the request-access form at convat.io/api (reply quoted within one business day).",
        "Sign a short evaluation agreement - this is a contract and needs the owner.",
        "Receive an evaluation key, confirm the environment is ready to start the 30 days.",
        "Choose a prepaid monthly plan for a production key.",
      ],
    },
    claims: [
      // Both source and destination, per the converter's two dropdowns.
      "1xBet", "22Bet", "BetKing", "Betwinner", "PariPesa", "MSport", "Football.com", "Betway",
      "Helabet", "Melbet", "betPawa", "Megapari", "Afropari", "BangBet", "Odibets", "Linebet",
      "1win", "888Starz", "Easybet", "LiveScore Bet", "Nairabet", "BC.GAME", "BetJam", "BetKadio",
      // Source only.
      "Bet9ja (source only)", "Betano (source only)", "Betika (source only)",
      "Mozzart (source only)", "SportPesa (source only)", "Meridianbet (source only)",
      // Destination only.
      "SportyBet (destination only)",
    ],
    verifyFirst: [
      "Whether the API's bookmaker list matches the consumer converter's list - the /api page quotes 50 sources and 56 destinations, which is not the same set.",
      "Ghana coverage specifically: the site names Accra but no page states supported countries for the API.",
      "That a created destination code reads back with the same selections and the same lines, which is the failure mode PariPesa already showed us.",
      "Idempotency behaviour under retry, since the docs require an Idempotency-Key and warn conversions can take about a minute.",
    ],
  },
  {
    id: "betloy",
    name: "Betloy",
    site: "https://betloy.com/",
    apiDocs: "https://betloy.com/api",
    observed:
      "GET /api/v1/bookmakers answered 401 AUTH_REQUIRED ('API or Widget key required'), so the API exists and is gated as documented.",
    access: {
      entry: "Free tier: NGN 0 forever, 10 units per month, no card required.",
      paid: "Individual NGN 10,000/month for 100 units (NGN 100 per unit). Business NGN 75,000/month for 2,000+ units (NGN 37.50 per unit). One credit per API call or conversion.",
      steps: [
        "Register an account at betloy.com/register - this creates an account in the owner's name.",
        "Generate an API key in the dashboard.",
        "Keys are server-side only; the published warning against client-side use matches our own rule.",
      ],
    },
    claims: [
      // Listed at brand-and-country granularity, which matches how this catalogue models them.
      "SportyBet (NG, GH, KE, TZ, UG, ZA)",
      "1xBet (NG, GH, BJ, CM, CI, ML, SN, KE, UG, TZ, ET, MW, ZM)",
      "PariPesa (NG, GH, KE, TZ, UG, ZM, ZA)",
      "22Bet (NG, GH, KE, TZ, UG, ET, ZM, ZA)",
      "MSport", "Football.com", "betPawa", "BangBet", "Bet9ja", "Hollywoodbets", "Odibets",
      "Helabet", "Betwinner", "Megapari", "Linebet", "Melbet", "Afropari", "888Starz",
    ],
    verifyFirst: [
      "The published rate limits contradict themselves - the table says Free is 10/min and 1,000 monthly requests, the FAQ says 10/min and 10 credits/month. Resolve before relying on either.",
      "Whether the free 10 units/month is enough to verify a round trip per bookmaker, or whether evaluation needs the paid tier.",
      "Whether 'Convert From' and 'Convert To' really are identical lists; perfectly symmetric capability across sixty operators is unusual and worth testing on the ones we care about.",
      "That a created destination code reads back with the same selections and lines.",
    ],
  },
];

/**
 * Operators GameClaw cannot currently convert, that at least one provider claims to cover.
 *
 * This is the commercial case in one function: every bookmaker we are blocked on appears on both
 * providers' lists. It is not evidence that a provider works - it is the reason an evaluation is
 * worth the owner's time.
 */
export const BLOCKED_BUT_CLAIMED: readonly string[] = [
  "MSport", // Cloudflare WAF refuses us; both providers claim it.
  "Betway", // no authorised route found; both claim it.
  "betPawa", // no authorised route found; both claim it.
  "1xBet", // SaveCoupon ErrorCode 161627; both claim it.
  "22Bet",
  "Betwinner",
  "PariPesa", // our own round trip created an empty coupon; both claim it.
];
