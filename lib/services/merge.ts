import "server-only";
import type { AuthUser } from "@/lib/auth";
import { mapWithConcurrency } from "@/lib/async";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { BookmakerSlug } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sameMarket } from "@/lib/markets/types";
import { getAliasIndex } from "@/lib/services/events";
import { convertSelection, SLIP_CONVERT_LIMIT } from "@/lib/services/convert";
import { requireEnabledBookmaker } from "@/lib/services/bookmakers";
import {
  getOwnedSlipRecord,
  marketOf,
  saveSlip,
  toSlipView,
  withLogos,
  type DraftSelection,
  type SlipRecord,
} from "@/lib/services/slips";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import type { SlipView } from "@/lib/slips/view";

/**
 * Combining selections from several slips into one.
 *
 * The same machinery as a conversion, pointed at more than one source. Every leg still has to be
 * found at the destination and priced there, because a leg carries a fixture and a market, not a
 * price - the price belongs to the bookmaker being asked. So merging is not a matter of
 * concatenating lists; it is a conversion with several starting points.
 *
 * What makes this real rather than a UI arrangement: the adapters for SportyBet and Football.com
 * take `createCode(selections[])`, an arbitrary list. A merged draft is just a list they have not
 * seen before, so the destination issues a genuine code for it through the same path a converted
 * slip uses, and the same readback applies.
 */

/** One leg a caller wants, named by the slip it came from and its position on that slip. */
export type MergePick = { slipId: string; position: number };

export type MergeDuplicate = {
  /** The picks that describe the same bet. Two or more. */
  picks: MergePick[];
  fixture: string;
  market: string;
};

export type MergePreview = {
  /** Picks that would be sent, after duplicates are resolved. */
  accepted: MergePick[];
  /** Same fixture and market from more than one slip. Reported, never silently dropped. */
  duplicates: MergeDuplicate[];
};

/**
 * What the chosen picks look like before anything is converted.
 *
 * Duplicates are the reason this exists. Importing the same slip twice, or two slips that share a
 * leg, produces picks that are the same bet - and a bookmaker will refuse a coupon with the same
 * selection on it twice. Dropping them quietly would mean the user's leg count silently disagrees
 * with the code they get; refusing the whole merge would make a common, harmless situation fatal.
 * So they are reported, and the caller decides.
 */
export function previewMerge(slips: readonly SlipRecord[], picks: readonly MergePick[]): MergePreview {
  const byId = new Map(slips.map((s) => [s.id, s]));
  const seen: { key: string; pick: MergePick; fixture: string; market: string }[] = [];

  for (const pick of picks) {
    const slip = byId.get(pick.slipId);
    const sel = slip?.selections.find((s) => s.position === pick.position);
    if (!slip || !sel) {
      throw new AppError("BAD_REQUEST", "That selection isn't on the slip it was taken from.");
    }
    const market = marketOf(sel);
    if (!market) continue;
    // Identity is the bet, not the bookmaker's wording: same fixture, same market, same line.
    const fixture = `${sel.homeTeam} v ${sel.awayTeam} @ ${sel.kickoffAt.toISOString()}`;
    seen.push({
      key: `${fixture}|${market.type}|${market.period}|${market.outcome}|${market.line ?? ""}`,
      pick,
      fixture,
      market: `${market.type} ${market.outcome}${market.line === null ? "" : ` ${market.line}`}`,
    });
  }

  const groups = new Map<string, typeof seen>();
  for (const row of seen) {
    const list = groups.get(row.key) ?? [];
    list.push(row);
    groups.set(row.key, list);
  }

  const accepted: MergePick[] = [];
  const duplicates: MergeDuplicate[] = [];
  for (const list of groups.values()) {
    // The first occurrence is kept so the merge can proceed; the rest are reported so the user
    // sees that their nine chosen legs became eight, and why.
    accepted.push(list[0].pick);
    if (list.length > 1) {
      duplicates.push({
        picks: list.map((r) => r.pick),
        fixture: list[0].fixture,
        market: list[0].market,
      });
    }
  }

  return { accepted, duplicates };
}

/**
 * Merges chosen legs from several slips onto one destination bookmaker.
 *
 * `book: false` does every expensive part - each fixture found at the destination, each market
 * priced there - and stops at a draft, which is what the user needs to decide with. Booking is a
 * second, explicit step through the existing path.
 */
export async function mergeSlips(opts: {
  user: AuthUser;
  picks: readonly MergePick[];
  target: BookmakerSlug;
  ipHash: string | null;
  book?: boolean;
}): Promise<{ slip: SlipView; duplicates: MergeDuplicate[] }> {
  const { user, target, ipHash } = opts;
  const book = opts.book ?? false;

  if (opts.picks.length < 2) {
    throw new AppError("BAD_REQUEST", "Pick at least two selections to merge.");
  }

  const slipIds = [...new Set(opts.picks.map((p) => p.slipId))];
  if (slipIds.length < 2) {
    throw new AppError("BAD_REQUEST", "Merging needs selections from at least two slips.");
  }

  // Ownership is checked per slip, so a merge cannot reach into somebody else's.
  const slips = await Promise.all(slipIds.map((id) => getOwnedSlipRecord(user, id)));

  const targetBookmaker = await requireEnabledBookmaker(target);
  const adapter = getAdapter(target);
  if (!adapter.capabilities.createCode) {
    throw new AppError("BAD_REQUEST", `${targetBookmaker.name} can't issue booking codes.`);
  }

  const { accepted, duplicates } = previewMerge(slips, opts.picks);
  if (accepted.length === 0) {
    throw new AppError("BAD_REQUEST", "None of those selections can be merged.");
  }

  await enforceRateLimit({ userId: user.id, kind: "SLIP_CONVERT", ...SLIP_CONVERT_LIMIT });

  const meta = { from: slipIds.length, to: target, picks: accepted.length };
  try {
    const aliases = await getAliasIndex();
    const now = new Date();

    const sources = accepted.map((pick) => {
      const slip = slips.find((s) => s.id === pick.slipId)!;
      return slip.selections.find((s) => s.position === pick.position)!;
    });
    const usable = sources.filter((s) => s.status === "OK");
    if (usable.length === 0) {
      throw new AppError("BAD_REQUEST", "None of those selections are available to merge.");
    }

    const results = await mapWithConcurrency(usable, 4, (sel) =>
      convertSelection(sel, adapter, aliases, now),
    );
    type Converted = Awaited<ReturnType<typeof convertSelection>>;
    const converted: Converted[] = results as Converted[];
    const ok = converted.filter((r) => r.draft.status === "OK").map((r) => r.draft);

    // A merged draft that lost a leg at the destination is still worth having: the user chose
    // which legs they wanted and can see which ones this bookmaker could not take, rather than
    // being handed a failure and their work thrown away.
    let code: string | null = null;
    let expiresAt: Date | null = null;
    if (book && ok.length > 0) {
      const created = await adapter
        .createCode(ok.map((d: DraftSelection) => ({ eventExternalId: d.event.externalId!, market: d.market! })))
        .catch((err) => {
          logger.warn("merge.booking_refused", { ...meta, err: String(err).slice(0, 300) });
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
      // A merge has several parents and the column holds one, so none is recorded rather than an
      // arbitrary one. Claiming a single parent would make the lineage wrong in the data.
      parentSlipId: null,
      expiresAt,
      selections: converted.map((r) => r.draft),
    });

    const view = await withLogos(toSlipView(saved));
    await logUsage({
      userId: user.id,
      ipHash,
      kind: "SLIP_CONVERT",
      success: true,
      meta: { ...meta, merged: ok.length, code },
    });
    logger.info("slips.merged", { ...meta, merged: ok.length, duplicates: duplicates.length });
    return { slip: view, duplicates };
  } catch (err) {
    await logUsage({
      userId: user.id,
      ipHash,
      kind: "SLIP_CONVERT",
      success: false,
      errorCode: err instanceof AppError ? err.code : "INTERNAL",
      meta,
    });
    throw err;
  }
}

/** Whether two markets are the same bet. Re-exported so the app can group duplicates the same way. */
export { sameMarket };
