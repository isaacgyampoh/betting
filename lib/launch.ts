import "server-only";

/**
 * What GameClaw gives away while it is finding its feet.
 *
 * Everything the product can do is free for launch. This is the one place that decides it, so
 * turning paid plans back on is a single edit here rather than an archaeology expedition through
 * the feature checks - the plans, prices, subscriptions and payment history all stay exactly where
 * they are, untouched and still working, and simply stop being consulted while this is on.
 *
 * Free is not the same as unlimited, and the difference matters. Behind every one of these
 * features is somebody else's bill: Anthropic for a conversation with Claw, API-Football for the
 * fixtures and statistics underneath it, on a key that allows a few hundred requests a minute for
 * the entire product. A ceiling here is not a sales tactic - it is what stops one enthusiastic
 * afternoon from taking the football data down for everybody. The numbers below are set well above
 * what a real person does in a day and well below what would hurt.
 *
 * So: no card, no plan, no trial expiry, and no feature withheld. Still a daily ceiling, and still
 * every other protection - sign-in, the 18+ gate, self-exclusion, rate limits, request timeouts.
 */
export const LAUNCH = {
  /** The switch. False restores the per-plan limits in the plans table, with nothing else to undo. */
  everythingFree: true,

  /**
   * The daily ceiling while everything is free.
   *
   * Roughly fifteen times the old free allowance, and comfortably more than a person gets through
   * in a day. Anyone reaching these is either having an extraordinary session or is not a person.
   */
  limits: {
    dailyAiRequests: 40,
    dailyTokenLimit: 400_000,
    dailyUploads: 15,
    dailySlipBuilds: 25,
    dailyAnalyses: 15,
  },

  /** Features that used to be the preserve of a paid tier, and are not withheld during launch. */
  allowDeepAnalysis: true,
  allowDailyPicks: true,
} as const;

/** Whether the launch giveaway is in force. Read this rather than the flag, so the reason is named. */
export function everythingIsFree(): boolean {
  return LAUNCH.everythingFree;
}
