import type { RawMarket } from "@/lib/bookmakers/types";
import type { Market, MarketPeriod, MarketType } from "@/lib/markets/types";

/**
 * betPawa's own market names, and what each one actually is.
 *
 * Keyed on the market's `name` as the booking-code payload gives it ("1X2 - FT"), with the pick
 * read from the selection's `name` ("1", "Over", "Yes"). betPawa does not put team names in the
 * outcome the way the label format expects, so this is its own table rather than a reuse.
 *
 * An unrecognised market maps to null, the selection still loads, and the leg is shown as one we
 * cannot convert. That is the safe failure, and it is what makes the table below safe to extend:
 * a name that is wrong simply never matches. What is *not* safe is a name that matches and means
 * something else, which converts into a different bet at the destination with nothing looking
 * wrong - so each row says whether a real payload has shown it.
 *
 * The clearest example is already in the table. "1X2 1UP" is not 1X2: it is a promotion that pays
 * out early if the side goes a goal ahead, so it wins in matches a 1X2 pick loses. Mapping it to
 * MATCH_RESULT would turn one bet into another silently, which is why it is listed as deliberately
 * unmapped rather than left to look like an oversight.
 */
type Def = { type: MarketType; period: MarketPeriod };

const MARKETS: Record<string, Def> = {
  // Every row here has been seen in a real booking code. The first attempt at this table inferred
  // six names from betPawa's "<market> - <period>" pattern and got two of the three that have
  // since appeared wrong - it is "Total Score Over/Under - FT", not "Over/Under - FT", and
  // "Handicap 1X2 - FT", not "Handicap - FT". So inference is out: a guessed name that never
  // matches costs a silent failure to convert, and looks identical to a market betPawa does not
  // sell.
  "1X2 - FT": { type: "MATCH_RESULT", period: "FT" }, // QANPYA1
  "Both Teams To Score - FT": { type: "BTTS", period: "FT" }, // CFQUYS8
  "Total Score Over/Under - FT": { type: "OVER_UNDER", period: "FT" }, // CFQUYS8
  // "Handicap 1X2" names itself three-way, which is what our HANDICAP is - home, draw or away
  // against a line. betPawa reports it as handicapType EUROPEAN, and an Asian handicap would be a
  // different market with a different name and only two outcomes.
  "Handicap 1X2 - FT": { type: "HANDICAP", period: "FT" }, // CFQUYS8
};

/**
 * Markets we can read but must never map, with the reason.
 *
 * Listed rather than omitted so that nobody "fixes" the gap by adding them to the table above.
 */
const NEVER_MAP: Record<string, string> = {
  "1X2 1UP - FT": "pays out early at one goal ahead, so it is not a 1X2 result and converts into a different bet",
  "1X2 2UP - FT": "pays out early at two goals ahead; same reason",
  // Both conditions have to come in. Our Market model holds one pick, so mapping this to either
  // half would drop a condition and hand someone an easier bet than the one they made.
  "1X2 and Totals - FT": "one bet on the result and the total together, which our model cannot carry as a single pick",
};

const OUTCOME: Record<string, Record<string, string>> = {
  MATCH_RESULT: { "1": "HOME", X: "DRAW", "2": "AWAY" },
  DOUBLE_CHANCE: { "1X": "HOME_DRAW", "12": "HOME_AWAY", X2: "DRAW_AWAY" },
  OVER_UNDER: { Over: "OVER", Under: "UNDER" },
  BTTS: { Yes: "YES", No: "NO" },
  // Three-way, so the draw is a real outcome and leaving it out would silently drop a pick.
  HANDICAP: { "1": "HOME", X: "DRAW", "2": "AWAY" },
};

/** The line out of betPawa's `formattedHandicap`, which carries "2.5" or "-1" or "". */
function parseLine(specifier: string): number | null {
  const trimmed = specifier.trim();
  return /^[+-]?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
}

export const betpawaFormat = {
  mapMarket(raw: RawMarket): Market | null {
    if (NEVER_MAP[raw.marketId]) return null;

    const def = MARKETS[raw.marketId];
    if (!def) return null;

    const outcome = OUTCOME[def.type]?.[raw.outcomeId.trim()];
    if (!outcome) return null;

    const line = parseLine(raw.specifier);
    // A totals or handicap market without a line is not a market we can rebuild elsewhere.
    if ((def.type === "OVER_UNDER" || def.type === "HANDICAP") && line === null) return null;

    return { ...def, outcome, line };
  },

  /** Why a market we recognise by name is nonetheless not convertible. Null when there is no reason. */
  refusedReason(raw: RawMarket): string | null {
    return NEVER_MAP[raw.marketId] ?? null;
  },
};

export const BETPAWA_MARKET_NAMES = Object.keys(MARKETS);
export const BETPAWA_NEVER_MAP = NEVER_MAP;
