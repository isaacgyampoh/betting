import type { BookmakerEventInfo, RawMarket } from "@/lib/bookmakers/types";
import { isForbiddenMarket, parseSpecialMarket, type SpecialMarket } from "@/lib/special-picks/markets";

/**
 * Turning a bookmaker's priced offers into things we could publish.
 *
 * Candidates start from the bookmaker, not from a list of markets we would like to exist. That
 * ordering is the whole of the brief's odds requirement: a statistical prediction is not
 * automatically a betting option, so the only selections considered are ones a bookmaker is
 * already pricing, with its own line, at a price we have read. Nothing here can invent an odds
 * figure because nothing here constructs one - the price comes in with the offer or the candidate
 * does not exist.
 *
 * Pure, and the input is the adapter's own `FixtureWithOffers` shape, so the whole of this can be
 * tested against fabricated offers without touching a bookmaker.
 */

export type SpecialCandidate = {
  event: BookmakerEventInfo;
  /** Bookmaker slug the price came from. */
  bookmaker: string;
  market: SpecialMarket;
  /** The bookmaker's own name for the market, kept verbatim so a later rename is traceable. */
  rawMarketName: string;
  line: number;
  outcome: "OVER" | "UNDER";
  odds: number;
};

/** The subset of an offer this needs; matches the adapter's FixtureOffer. */
type Offer = { raw: RawMarket; odds: number };
type FixtureOffers = { event: BookmakerEventInfo; offers: Offer[] };

/**
 * The line out of a bookmaker's specifier.
 *
 * Hopegaming sends it as `total=9.5`, and occasionally with more than one term. The first number
 * is the line; anything that is not a number is not a line, and a specifier that carries none
 * means the offer is not a totals market whatever its name says.
 */
export function parseLine(specifier: string | undefined): number | null {
  const m = /(-?\d+(?:\.\d+)?)/.exec(specifier ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Over or under, from the outcome's own name.
 *
 * Read rather than inferred from an outcome id: ids are per-market and a mapping of them is one
 * more private vocabulary to maintain, where the word itself is unambiguous.
 */
export function parseOutcome(outcomeName: string | undefined): "OVER" | "UNDER" | null {
  const n = (outcomeName ?? "").trim().toLowerCase();
  if (n === "over" || n.startsWith("over ")) return "OVER";
  if (n === "under" || n.startsWith("under ")) return "UNDER";
  return null;
}

/**
 * Whole-number lines are refused.
 *
 * A line of exactly 10 can be settled as a push - stake returned - and this feature has no VOID
 * path for a push as opposed to a postponed match, so publishing one would eventually produce a
 * selection the record cannot describe. Every line seen in the probe was a half, so nothing is
 * lost by requiring it.
 */
function isHalfLine(line: number): boolean {
  return Math.abs(line * 2 - Math.round(line * 2)) < 1e-9 && Math.abs(line - Math.round(line)) > 1e-9;
}

export function candidatesFrom(bookmaker: string, fixtures: readonly FixtureOffers[]): SpecialCandidate[] {
  const out: SpecialCandidate[] = [];

  for (const { event, offers } of fixtures) {
    // A fixture that has started cannot be published, whatever its prices look like.
    if (event.status !== "NOT_STARTED") continue;

    for (const offer of offers) {
      const name = offer.raw.marketName;
      if (!name) continue;

      // Checked here as well as inside parseSpecialMarket. The duplication is deliberate: this is
      // the boundary where a bookmaker's whole catalogue arrives, and the brief's hardest rule is
      // that result and goals markets must never reach a daily slot.
      if (isForbiddenMarket(name)) continue;

      const market = parseSpecialMarket(name);
      if (!market) continue;

      const line = parseLine(offer.raw.specifier);
      if (line === null || !isHalfLine(line) || line <= 0) continue;

      const outcome = parseOutcome(offer.raw.outcomeName);
      if (!outcome) continue;

      // A price at or below evens-on-the-stake is not a price we can value, and a missing one is
      // not a price at all.
      if (!Number.isFinite(offer.odds) || offer.odds <= 1) continue;

      out.push({ event, bookmaker, market, rawMarketName: name, line, outcome, odds: offer.odds });
    }
  }

  return out;
}

/**
 * One candidate per fixture and market, keeping the best-priced.
 *
 * A bookmaker lists every line it offers - the probe found eighteen Shots Over/Under offers on one
 * fixture - and they are the same opinion at different thresholds. Carrying all of them into
 * ranking would let one fixture occupy both daily slots with what is substantially one bet, which
 * the brief forbids. The line itself is chosen later, on the evidence; this only stops the same
 * market appearing repeatedly.
 */
export function dedupe(candidates: readonly SpecialCandidate[]): SpecialCandidate[] {
  const best = new Map<string, SpecialCandidate>();
  for (const c of candidates) {
    const key = `${c.event.externalId}|${c.market.kind}|${c.market.side}|${c.outcome}|${c.line}`;
    const existing = best.get(key);
    if (!existing || c.odds > existing.odds) best.set(key, c);
  }
  return [...best.values()];
}
