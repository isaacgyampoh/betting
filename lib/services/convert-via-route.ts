import "server-only";
import type { RouteResult, RouteSelection, RouteUnmatched } from "@/lib/bookmakers/providers/types";
import type { SelectionStatus } from "@/lib/generated/prisma/enums";
import type { DraftSelection, SlipRecord } from "@/lib/services/slips";

/**
 * Turning a provider's conversion result back into our own slip model.
 *
 * A provider hands back a destination code plus a flat list of legs described in its own words:
 * an event name like "Arsenal vs Chelsea", a market label, a selection label. It does not hand
 * back fixture ids, kick-off times or our market model, and inventing those from a string is
 * exactly where a conversion starts lying - "Arsenal vs Chelsea" could be either of two fixtures
 * in a week, and a parsed kick-off that is a day out looks entirely plausible on screen.
 *
 * So the composition runs the other way round. One draft is produced per *source* selection, in
 * the source's order, carrying the source's own event identity - the teams, the kick-off and the
 * competition, which we already hold accurately because we read that slip ourselves. Only the
 * things the provider genuinely knows better are taken from it: the destination's price, the
 * destination's market wording, and whether the leg survived at all.
 *
 * A source selection the provider never mentions is reported as not found rather than dropped.
 */

/** Strip accents and punctuation so "Atlético" and "Atletico" are the same word. */
function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words in a club name long enough to identify it. "FC", "SC" and "AC" identify nothing. */
function distinctiveTokens(name: string): string[] {
  return normalise(name)
    .split(" ")
    .filter((t) => t.length >= 4);
}

/**
 * Whether a provider's event name refers to this fixture.
 *
 * Containment on a distinctive word from each side, rather than string equality: providers
 * abbreviate ("Man United" for "Manchester United"), reorder, and vary the separator. Requiring
 * one solid word from each team is strict enough that two different fixtures do not collide and
 * loose enough that normal abbreviation still matches.
 */
export function eventNameMatches(home: string, away: string, eventName: string): boolean {
  const hay = normalise(eventName);
  if (!hay) return false;
  const side = (team: string) => {
    const tokens = distinctiveTokens(team);
    // A name with no long word at all ("Roma", "Lyon") falls back to the whole normalised string.
    if (tokens.length === 0) return hay.includes(normalise(team));
    return tokens.some((t) => hay.includes(t));
  };
  return side(home) && side(away);
}

/** The provider's own words for why a leg did not survive, mapped onto our statuses. */
export function statusForReason(reason: string, reasonText: string): SelectionStatus {
  const s = `${reason} ${reasonText}`.toLowerCase();
  if (s.includes("start") || s.includes("in play") || s.includes("live")) return "EVENT_STARTED";
  if (s.includes("market") || s.includes("odds") || s.includes("price")) return "MARKET_NOT_FOUND";
  if (s.includes("event") || s.includes("fixture") || s.includes("match")) return "EVENT_NOT_FOUND";
  return "UNSUPPORTED_MARKET";
}

type Leg =
  | { kind: "matched"; leg: RouteSelection }
  | { kind: "unmatched"; leg: RouteUnmatched };

function findLeg(sel: SlipRecord["selections"][number], result: RouteResult): Leg | null {
  const matched = result.matched.find((l) => eventNameMatches(sel.homeTeam, sel.awayTeam, l.eventName));
  if (matched) return { kind: "matched", leg: matched };
  const unmatched = result.unmatched.find((l) => eventNameMatches(sel.homeTeam, sel.awayTeam, l.eventName));
  if (unmatched) return { kind: "unmatched", leg: unmatched };
  return null;
}

export function draftsFromRoute(sourceSlip: SlipRecord, result: RouteResult): DraftSelection[] {
  return sourceSlip.selections.map((sel, i): DraftSelection => {
    const event = {
      // The destination's own fixture id is not something the provider returns, and a slip
      // converted this way is never re-booked by us - the provider already booked it.
      externalId: null,
      home: sel.homeTeam,
      away: sel.awayTeam,
      kickoffAt: sel.kickoffAt,
      competition: sel.competition,
    };
    const found = findLeg(sel, result);

    if (!found) {
      return {
        position: i + 1,
        event,
        market: null,
        odds: null,
        raw: null,
        status: "EVENT_NOT_FOUND",
        reason: `${result.routeId} did not return this game.`,
      };
    }

    if (found.kind === "unmatched") {
      const { leg } = found;
      return {
        position: i + 1,
        event,
        market: null,
        odds: null,
        raw: { marketId: "", outcomeId: "", specifier: "", marketName: leg.market, outcomeName: leg.selection },
        status: statusForReason(leg.reason, leg.reasonText),
        reason: leg.reasonText || leg.reason,
      };
    }

    const { leg } = found;
    return {
      position: i + 1,
      event,
      // Our structured market model is not recoverable from a label, and guessing it would let a
      // mis-read label book a different bet later. The view falls back to these names.
      market: null,
      odds: leg.targetOdds,
      raw: {
        // Empty on purpose: these are the destination's booking ids, which a provider route never
        // gives us. Anything written here would be a fabricated id that some later code path
        // could try to book with.
        marketId: "",
        outcomeId: "",
        specifier: leg.line ?? "",
        marketName: leg.market,
        outcomeName: leg.selection,
      },
      status: "OK",
      reason: leg.lineAdjusted
        ? `${sourceSlip.bookmaker.name} had ${leg.line ?? "a different line"}; the destination priced its own.`
        : null,
    };
  });
}
