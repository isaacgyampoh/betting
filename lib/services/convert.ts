import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { BookmakerAdapter, BookmakerSlug, RawMarket } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sameMarket } from "@/lib/markets/types";
import { bestMatch, type AliasIndex } from "@/lib/matching/similarity";
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

/** The same game by its shared id, or null when this bookmaker does not know it under that id. */
async function convertById(sel: SlipRecord["selections"][number], adapter: BookmakerAdapter): Promise<Found | null> {
  const id = sel.bookmakerEvent?.externalId;
  // Only the Sportradar id space is shared. A bookmaker with its own ids would just 404 on this.
  if (!id || !id.startsWith("sr:match:")) return null;
  const hit = await adapter.getEventMarkets(id).catch((err) => {
    // Not an outage: this bookmaker may simply not list the game. Fall back to looking it up.
    logger.info("convert.by_id_missed", { bookmaker: adapter.slug, eventId: id, err: String(err).slice(0, 200) });
    return null;
  });
  if (!hit?.offers.length) return null;
  return { target: hit.event, offers: hit.offers, score: 1 };
}

async function convertByName(
  sel: SlipRecord["selections"][number],
  adapter: BookmakerAdapter,
  aliases: AliasIndex,
): Promise<Found | null> {
  const candidates = await adapter.searchEvent(sel.homeTeam, sel.awayTeam, sel.kickoffAt).catch((err) => {
    throw asBookmakerError(err, adapter.slug, "searchEvent");
  });
  const match = bestMatch({ home: sel.homeTeam, away: sel.awayTeam, kickoffAt: sel.kickoffAt }, candidates, aliases);
  if (!match) return null;
  const { offers } = await adapter.getEventMarkets(match.candidate.externalId).catch((err) => {
    throw asBookmakerError(err, adapter.slug, "getEventMarkets");
  });
  return { target: match.candidate, offers, score: match.score };
}

async function convertSelection(
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
  const byId = await convertById(sel, adapter);

  const found = byId ?? (await convertByName(sel, adapter, aliases));
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
