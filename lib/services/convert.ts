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
  type DraftSelection,
  type SlipRecord,
} from "@/lib/services/slips";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import type { SlipView } from "@/lib/slips/view";

export const SLIP_CONVERT_LIMIT = { limit: 20, windowMs: 60 * 60_000 };

export type ConvertSource = { slipId: string } | { bookmaker: BookmakerSlug; code: string };

type Converted = { draft: DraftSelection; link?: { targetExternalId: string; score: number } };

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

  const candidates = await adapter.searchEvent(sel.homeTeam, sel.awayTeam, sel.kickoffAt).catch((err) => {
    throw asBookmakerError(err, adapter.slug, "searchEvent");
  });
  const match = bestMatch({ home: sel.homeTeam, away: sel.awayTeam, kickoffAt: sel.kickoffAt }, candidates, aliases);
  if (!match) return skip("EVENT_NOT_FOUND");

  const target = match.candidate;
  const targetEvent = { ...target, externalId: null };
  const { offers } = await adapter.getEventMarkets(target.externalId).catch((err) => {
    throw asBookmakerError(err, adapter.slug, "getEventMarkets");
  });
  const offer = offers.find((o) => o.market && sameMarket(o.market, market));
  const link = { targetExternalId: target.externalId, score: match.score };
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
export async function convertSlip(opts: { user: AuthUser; source: ConvertSource; target: BookmakerSlug; ipHash: string | null }): Promise<SlipView> {
  const { user, target, ipHash } = opts;

  const sourceSlip =
    "slipId" in opts.source
      ? await getOwnedSlipRecord(user, opts.source.slipId)
      : await getOwnedSlipRecord(user, (await loadSlip({ user, ipHash, ...opts.source })).id);

  if (sourceSlip.bookmaker.slug === target) {
    throw new AppError("BAD_REQUEST", `This slip is already on ${sourceSlip.bookmaker.name}. Pick a different bookmaker.`);
  }
  const targetBookmaker = await requireEnabledBookmaker(target);
  await enforceRateLimit({ userId: user.id, kind: "SLIP_CONVERT", ...SLIP_CONVERT_LIMIT });

  const meta = { from: sourceSlip.bookmaker.slug, to: target, sourceSlipId: sourceSlip.id };
  try {
    const adapter = getAdapter(target);
    const aliases = await getAliasIndex();
    const now = new Date();
    const sources = sourceSlip.selections.filter((s) => s.status === "OK");
    if (sources.length === 0) throw new AppError("BAD_REQUEST", "This slip has no games to convert.");

    const results = await mapWithConcurrency(sources, 4, (sel) => convertSelection(sel, adapter, aliases, now));
    const ok = results.filter((r) => r.draft.status === "OK").map((r) => r.draft);

    let code: string | null = null;
    let expiresAt: Date | null = null;
    if (ok.length > 0) {
      const created = await adapter
        .createCode(ok.map((d) => ({ eventExternalId: d.event.externalId!, market: d.market! })))
        .catch((err) => {
          throw asBookmakerError(err, target, "createCode");
        });
      code = created.code;
      expiresAt = created.expiresAt;
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

    const view = toSlipView(saved);
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
