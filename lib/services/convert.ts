import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { getAdapter } from "@/lib/bookmakers/registry";
import { routeFor } from "@/lib/bookmakers/providers/routes";
import { draftsFromRoute } from "@/lib/services/convert-via-route";
import type { BookmakerAdapter, BookmakerSlug, RawMarket } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sameMarket } from "@/lib/markets/types";
import {
  KICKOFF_TOLERANCE_MS,
  MATCH_THRESHOLD,
  soleMatch,
  teamSimilarity,
  type AliasIndex,
} from "@/lib/matching/similarity";
import { requireEnabledBookmaker } from "@/lib/services/bookmakers";
import { getAliasIndex, linkMatchedEvents } from "@/lib/services/events";
import {
  asBookmakerError,
  getOwnedSlipRecord,
  loadSlip,
  marketOf,
  saveSlip,
  toSlipView,
  withLogos,
  type DraftSelection,
  type SlipRecord,
} from "@/lib/services/slips";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import type { SlipView } from "@/lib/slips/view";

export const SLIP_CONVERT_LIMIT = { limit: 20, windowMs: 60 * 60_000 };

export type ConvertSource = { slipId: string } | { bookmaker?: BookmakerSlug; code: string };

type Converted = { draft: DraftSelection; link?: { targetExternalId: string; score: number } };

type Found = { target: { externalId: string; home: string; away: string; kickoffAt: Date; competition: string | null }; offers: Awaited<ReturnType<BookmakerAdapter["getEventMarkets"]>>["offers"]; score: number };

/**
 * A loose floor for competition names, not a match requirement.
 *
 * Measured 2026-11-06 over 30 fixtures carried by both SportyBet and MSport under the same
 * Sportradar id: the competition string was byte-identical on every one of them, so anything in
 * this region is comfortable. It is set low all the same, because the check exists to catch a
 * destination that has handed us a different game entirely - not to arbitrate "Premier League"
 * against "England Premier League", which are the same competition and score 0.88.
 */
const COMPETITION_CONFLICT_FLOOR = 0.5;

/**
 * Why a fixture returned for a shared id is not the game we asked for - or null when it is.
 *
 * An id-based conversion rests on one premise: `sr:match:N` means the same fixture at every
 * bookmaker on the platform. That premise is worth more than any name comparison, and this check is
 * deliberately not a second opinion on it. Re-matching the names would make things worse: over the
 * same 30 shared fixtures, SportyBet's "RC Deportivo de A Coruna" is MSport's "La Coruna", which
 * score 0.38 against a 0.8 threshold. Demanding both sides agree would throw that conversion away,
 * and the id was right.
 *
 * So each clause below is calibrated to fire only when the premise itself has broken - a different
 * game under the same id - and never on two feeds spelling the same game differently:
 *
 *   kick-off   differed by 0 minutes on all 30. A different game at the same minute is not a thing.
 *   teams      at least one side must be recognisable. The worst real pair still scored 1.00 on its
 *              other side, and a wrong fixture would miss on both.
 *   competition only when both carry one, and only against the loose floor above.
 */
function conflictWith(
  want: { home: string; away: string; kickoffAt: Date; competition: string | null },
  got: { home: string; away: string; kickoffAt: Date; competition: string | null },
  aliases: AliasIndex,
): string | null {
  if (Math.abs(got.kickoffAt.getTime() - want.kickoffAt.getTime()) > KICKOFF_TOLERANCE_MS) return "kickoff";
  const home = teamSimilarity(want.home, got.home, aliases);
  const away = teamSimilarity(want.away, got.away, aliases);
  if (Math.max(home, away) < MATCH_THRESHOLD) return "teams";
  if (want.competition && got.competition) {
    if (teamSimilarity(want.competition, got.competition, aliases) < COMPETITION_CONFLICT_FLOOR) return "competition";
  }
  return null;
}

/** The same game by its shared id, or null when this bookmaker does not know it under that id. */
async function convertById(
  sel: SlipRecord["selections"][number],
  adapter: BookmakerAdapter,
  aliases: AliasIndex,
): Promise<Found | null> {
  const id = sel.bookmakerEvent?.externalId;
  // Only the Sportradar id space is shared. A bookmaker with its own ids would just 404 on this.
  if (!id || !id.startsWith("sr:match:")) return null;
  const hit = await adapter.getEventMarkets(id).catch((err) => {
    // Not an outage: this bookmaker may simply not list the game. Fall back to looking it up.
    logger.info("convert.by_id_missed", { bookmaker: adapter.slug, eventId: id, err: String(err).slice(0, 200) });
    return null;
  });
  if (!hit?.offers.length) return null;
  // The id is shared, so this should always be the same fixture. If it is not, the premise has
  // broken and the right move is to fall through to the name search rather than price the wrong
  // game - which would reach the user as a perfectly ordinary-looking leg.
  const conflict = conflictWith({ home: sel.homeTeam, away: sel.awayTeam, kickoffAt: sel.kickoffAt, competition: sel.competition }, hit.event, aliases);
  if (conflict) {
    logger.warn("convert.id_conflict", { bookmaker: adapter.slug, eventId: id, on: conflict });
    return null;
  }
  return { target: hit.event, offers: hit.offers, score: 1 };
}

/**
 * Bookmakers that address a fixture by its Sportradar id.
 *
 * All three run the hopegaming platform, so `sr:match:N` means the same game on each - which is
 * what makes conversion between them exact rather than a name match.
 */
const SPORTRADAR_SPACE: readonly BookmakerSlug[] = ["sportybet", "msport", "footballcom"];

/** Bookmakers in that space whose own fixture search actually reaches beyond today. */
const ID_RESOLVERS: readonly BookmakerSlug[] = ["sportybet", "footballcom"];

/**
 * Ask a bookmaker that can find the game what its Sportradar id is, then address the destination
 * by that id.
 *
 * MSport shares the id space but cannot search its own feed past the live window: `pageNum` is
 * ignored and `pageSize` capped at 50, so `all-matches/next-7-days` returns the fifty games
 * nearest kick-off and nothing else. A source with its own ids - betPawa - therefore converted to
 * MSport at 0 of 4 fixtures, while SportyBet and Football.com found 4 of 4 by name.
 *
 * This runs only after both other strategies have failed, so it costs nothing on the common path,
 * and only for destinations in the shared id space: anywhere else the id would mean nothing.
 */
async function convertViaSharedId(
  sel: SlipRecord["selections"][number],
  adapter: BookmakerAdapter,
  aliases: AliasIndex,
): Promise<Found | null> {
  if (!SPORTRADAR_SPACE.includes(adapter.slug)) return null;

  for (const slug of ID_RESOLVERS) {
    if (slug === adapter.slug) continue;
    const resolver = getAdapter(slug);
    if (!resolver.capabilities.events) continue;

    const candidates = await resolver.searchEvent(sel.homeTeam, sel.awayTeam, sel.kickoffAt).catch(() => []);
    // soleMatch, not bestMatch: this is a name match made on the user's behalf at a bookmaker they
    // never asked about, and two different games fitting equally well is not something to resolve by
    // feed order. Refusing leaves the leg unconverted and explained.
    const match = soleMatch({ home: sel.homeTeam, away: sel.awayTeam, kickoffAt: sel.kickoffAt }, candidates, aliases);
    const id = match?.candidate.externalId;
    if (!id?.startsWith("sr:match:")) continue;

    const hit = await adapter.getEventMarkets(id).catch(() => null);
    if (!hit?.offers.length) continue;

    // Two hops, so two chances to land on the wrong game: the resolver's name match, then the
    // destination's reading of the id. The first was checked by soleMatch against the source; this
    // checks the second against the source as well, rather than trusting the chain end to end.
    const conflict = conflictWith({ home: sel.homeTeam, away: sel.awayTeam, kickoffAt: sel.kickoffAt, competition: sel.competition }, hit.event, aliases);
    if (conflict) {
      logger.warn("convert.resolver_conflict", { destination: adapter.slug, resolver: slug, eventId: id, on: conflict });
      continue;
    }

    logger.info("convert.resolved_via", { destination: adapter.slug, resolver: slug, eventId: id });
    // The resolver's own confidence in the name match carries over: the id step after it is exact.
    return { target: hit.event, offers: hit.offers, score: match!.score };
  }
  return null;
}

async function convertByName(
  sel: SlipRecord["selections"][number],
  adapter: BookmakerAdapter,
  aliases: AliasIndex,
): Promise<Found | null> {
  const candidates = await adapter.searchEvent(sel.homeTeam, sel.awayTeam, sel.kickoffAt).catch((err) => {
    throw asBookmakerError(err, adapter.slug, "searchEvent");
  });
  // Ambiguity is refused here too: a slip converted to the wrong fixture is worse than one that
  // reports the leg as not found, because only the second is visible to the person betting it.
  const match = soleMatch({ home: sel.homeTeam, away: sel.awayTeam, kickoffAt: sel.kickoffAt }, candidates, aliases);
  if (!match) return null;
  const { offers } = await adapter.getEventMarkets(match.candidate.externalId).catch((err) => {
    throw asBookmakerError(err, adapter.slug, "getEventMarkets");
  });
  return { target: match.candidate, offers, score: match.score };
}

/**
 * Finds one selection at a destination and prices it there.
 *
 * Exported for the merge service, which does exactly this for legs taken from several slips. The
 * alternative was a second copy of the matching rules, which is the one place a divergence would
 * be invisible: a merged leg and a converted leg must resolve to the same fixture and the same
 * market, or the same pick books differently depending on which screen the user came from.
 */
export async function convertSelection(
  sel: SlipRecord["selections"][number],
  adapter: BookmakerAdapter,
  aliases: AliasIndex,
  now: Date,
): Promise<Converted> {
  const market = marketOf(sel);
  const sourceEvent = {
    externalId: null,
    home: sel.homeTeam,
    away: sel.awayTeam,
    kickoffAt: sel.kickoffAt,
    competition: sel.competition,
  };
  const sourceRaw = (sel.raw as RawMarket | null) ?? null;
  const skip = (status: DraftSelection["status"], event = sourceEvent): Converted => ({
    draft: { position: sel.position, event, market, odds: null, raw: sourceRaw, status },
  });

  if (!market) return skip("UNSUPPORTED_MARKET");
  if (sel.kickoffAt <= now) return skip("EVENT_STARTED");

  // SportyBet, MSport and Football.com all run on Sportradar ids, so the same game is the same id
  // on each of them. Asking for it directly is exact and it is one request - where searching by
  // name means scanning a list the bookmaker will only serve the front of. MSport's returns its
  // earliest fifty fixtures and ignores the page number entirely, so anything kicking off later
  // today simply could not be found, and converting a slip failed for most of the day's football.
  const byId = await convertById(sel, adapter, aliases);

  const found =
    byId ?? (await convertByName(sel, adapter, aliases)) ?? (await convertViaSharedId(sel, adapter, aliases));
  if (!found) return skip("EVENT_NOT_FOUND");
  const { target, offers, score } = found;
  const targetEvent = { ...target, externalId: null };
  const offer = offers.find((o) => o.market && sameMarket(o.market, market));
  const link = { targetExternalId: target.externalId, score };
  if (!offer) return { ...skip("MARKET_NOT_FOUND", targetEvent), link };

  return {
    draft: {
      position: sel.position,
      event: { externalId: target.externalId, home: target.home, away: target.away, kickoffAt: target.kickoffAt, competition: target.competition },
      market,
      odds: offer.odds,
      raw: offer.raw,
      status: "OK",
    },
    link,
  };
}

/**
 * Converts a slip to another bookmaker: matches each game (aliases + fuzzy names, kickoff ±15 min),
 * finds the same market, books a new code, and keeps every game that couldn't be carried over
 * (with the reason) so nothing is silently dropped.
 */
/**
 * Convert through a third-party provider, for a pair our own adapters cannot serve.
 *
 * Returns null - not an error - when there is nothing to try: no configured route claims this
 * pair, or the source slip has no booking code for a provider to read. The caller then falls
 * through to the ordinary refusal, which explains the real situation better than anything this
 * function could say.
 *
 * The provider books at the destination itself, so there is no second booking step here and no
 * event linking: we never see the destination's fixture ids, and writing links from names we did
 * not resolve ourselves would poison the alias index that the native route depends on.
 */
async function convertThroughProvider(opts: {
  user: AuthUser;
  sourceSlip: SlipRecord;
  targetBookmaker: { id: string; name: string; country: string };
  target: BookmakerSlug;
  ipHash: string | null;
}): Promise<SlipView | null> {
  const { user, sourceSlip, targetBookmaker, target, ipHash } = opts;

  // A provider converts a booking code. A slip we built rather than read has none, and there is
  // nothing to hand over.
  if (!sourceSlip.bookingCode) return null;

  const from = { brand: sourceSlip.bookmaker.name, country: sourceSlip.bookmaker.country };
  const to = { brand: targetBookmaker.name, country: targetBookmaker.country };
  const route = routeFor(from, to);
  if (!route) return null;

  await enforceRateLimit({ userId: user.id, kind: "SLIP_CONVERT", ...SLIP_CONVERT_LIMIT });

  const meta = { from: sourceSlip.bookmaker.slug, to: target, sourceSlipId: sourceSlip.id, route: route.id };
  try {
    // Stable per user-intent: the same user asking for the same slip at the same destination must
    // reuse the provider's first result rather than paying for, and booking, a second code.
    const result = await route.convert({
      from,
      to,
      code: sourceSlip.bookingCode,
      idempotencyKey: `${user.id}:${sourceSlip.id}:${target}`,
    });

    const selections = draftsFromRoute(sourceSlip, result);
    const saved = await saveSlip({
      userId: user.id,
      bookmakerId: targetBookmaker.id,
      kind: "CONVERTED",
      code: result.targetCode,
      parentSlipId: sourceSlip.id,
      expiresAt: result.expiresAt,
      selections,
    });

    const view = await withLogos(toSlipView(saved));
    const converted = selections.filter((d) => d.status === "OK").length;
    await logUsage({
      userId: user.id,
      ipHash,
      kind: "SLIP_CONVERT",
      success: true,
      meta: { ...meta, total: selections.length, converted, code: result.targetCode },
    });
    logger.info("slips.converted_via_route", { ...meta, total: selections.length, converted });
    return view;
  } catch (err) {
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_CONVERT", success: false, errorCode: err instanceof AppError ? err.code : "INTERNAL", meta });
    throw err;
  }
}

export async function convertSlip(opts: {
  user: AuthUser;
  source: ConvertSource;
  target: BookmakerSlug;
  ipHash: string | null;
  /**
   * Whether to ask the bookmaker for a code, or stop at the draft.
   *
   * False does every expensive part - finding each game at the destination and reading that
   * bookmaker's own price for the same market - and then stops. What comes back is a real,
   * saved slip with no code, which is exactly what the user needs to decide with: how many of
   * their selections this destination can actually carry, which ones it cannot, and why. Booking
   * it afterwards is a second, explicit step that reuses this work rather than repeating it.
   */
  book?: boolean;
}): Promise<SlipView> {
  const { user, target, ipHash } = opts;
  const book = opts.book ?? true;

  const sourceSlip =
    "slipId" in opts.source
      ? await getOwnedSlipRecord(user, opts.source.slipId)
      : await getOwnedSlipRecord(user, (await loadSlip({ user, ipHash, ...opts.source })).id);

  if (sourceSlip.bookmaker.slug === target) {
    throw new AppError("BAD_REQUEST", `This slip is already on ${sourceSlip.bookmaker.name}. Pick a different bookmaker.`);
  }
  const targetBookmaker = await requireEnabledBookmaker(target);

  // Refuse a destination that cannot book, before doing any of the work.
  //
  // The app only offers bookmakers whose capabilities say they can issue a code, so this is not
  // reachable from the UI. It is reachable from the API, and without it the request did every
  // expensive thing - finding each game at the destination, reading its prices - and then failed
  // on the final write, having told the user nothing useful and spent the bookmaker's quota to
  // learn what the capability flag already knew. The adapter's own refusal message is better than
  // anything generic here: it says whether this is a bookmaker we have not finished, or one that
  // is turning us away.
  const targetAdapter = getAdapter(target);
  if (!targetAdapter.capabilities.createCode) {
    /**
     * A destination we cannot book at ourselves is exactly what a conversion provider is for.
     *
     * Seven of the nine bookmakers in the catalogue sit here, waiting on an authorised
     * integration that is a commercial arrangement rather than a missing function. A configured
     * provider route covers that pair in one call, so it is tried before the refusal - and when
     * no route is configured, or none claims this pair, the refusal stands and says so plainly.
     */
    const viaRoute = await convertThroughProvider({ user, sourceSlip, targetBookmaker, target, ipHash });
    if (viaRoute) return viaRoute;

    await targetAdapter.createCode([]).catch((err: unknown) => {
      throw err;
    });
    throw new AppError("BAD_REQUEST", `${targetBookmaker.name} can't issue booking codes.`);
  }

  await enforceRateLimit({ userId: user.id, kind: "SLIP_CONVERT", ...SLIP_CONVERT_LIMIT });

  const meta = { from: sourceSlip.bookmaker.slug, to: target, sourceSlipId: sourceSlip.id };
  try {
    const adapter = targetAdapter;
    const aliases = await getAliasIndex();
    const now = new Date();
    const sources = sourceSlip.selections.filter((s) => s.status === "OK");
    if (sources.length === 0) throw new AppError("BAD_REQUEST", "This slip has no games to convert.");

    const results = await mapWithConcurrency(sources, 4, (sel) => convertSelection(sel, adapter, aliases, now));
    const ok = results.filter((r) => r.draft.status === "OK").map((r) => r.draft);

    // Booking is the last step and the only one that needs the bookmaker to accept a write. The
    // conversion itself - finding each game and reading that bookmaker's own price - has already
    // succeeded by this point, and that is the part that is hard to do by hand. Losing all of it
    // because the booking was refused leaves the user with nothing when we are holding the answer,
    // so a refused booking returns the slip without a code and says so.
    let code: string | null = null;
    let expiresAt: Date | null = null;
    if (book && ok.length > 0) {
      const created = await adapter
        .createCode(ok.map((d) => ({ eventExternalId: d.event.externalId!, market: d.market! })))
        .catch((err) => {
          logger.warn("convert.booking_refused", { ...meta, picks: ok.length, err: String(err).slice(0, 300) });
          return null;
        });
      code = created?.code ?? null;
      expiresAt = created?.expiresAt ?? null;
    }

    const saved = await saveSlip({
      userId: user.id,
      bookmakerId: targetBookmaker.id,
      kind: "CONVERTED",
      code,
      parentSlipId: sourceSlip.id,
      expiresAt,
      selections: results.map((r) => r.draft),
    });

    await linkMatchedEvents(
      results.flatMap((r, i) => {
        if (!r.link) return [];
        const src = sources[i];
        const tgt = r.draft.event;
        return src.bookmakerEvent
          ? [
              {
                score: r.link.score,
                source: { bookmakerId: sourceSlip.bookmaker.id, externalId: src.bookmakerEvent.externalId, home: src.homeTeam, away: src.awayTeam, kickoffAt: src.kickoffAt, competition: src.competition },
                target: { bookmakerId: targetBookmaker.id, externalId: r.link.targetExternalId, home: tgt.home, away: tgt.away, kickoffAt: tgt.kickoffAt, competition: tgt.competition },
              },
            ]
          : [];
      }),
    );

    const view = await withLogos(toSlipView(saved));
    await logUsage({
      userId: user.id,
      ipHash,
      kind: "SLIP_CONVERT",
      success: true,
      meta: { ...meta, total: sources.length, converted: ok.length, code },
    });
    logger.info("slips.converted", { ...meta, total: sources.length, converted: ok.length });
    return view;
  } catch (err) {
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_CONVERT", success: false, errorCode: err instanceof AppError ? err.code : "INTERNAL", meta });
    throw err;
  }
}
