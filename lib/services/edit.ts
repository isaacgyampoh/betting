import "server-only";
import type { AuthUser } from "@/lib/auth";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { BookmakerSlug, RawMarket } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { applyEdit, type EditOp } from "@/lib/slips/edit";
import type { SlipView } from "@/lib/slips/view";
import { asBookmakerError, getOwnedSlipRecord, marketOf, saveSlip, toSlipView, withLogos, type DraftSelection } from "@/lib/services/slips";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";

export const SLIP_EDIT_LIMIT = { limit: 60, windowMs: 60 * 60_000 };

/**
 * Applies an edit (remove / safest N / trim to odds / split) and books a new code for each
 * resulting slip. Only bookable games (active, mapped market, not started) are used.
 *
 * `book` is a request, not a guarantee: a bookmaker we cannot create codes at yet still returns the
 * edited slip, without a code, so the user can see the result and place it themselves. Failing the
 * whole edit because we cannot book it would throw away work the user asked for.
 */
export async function editSlip(opts: { user: AuthUser; slipId: string; op: EditOp; book: boolean; ipHash: string | null }): Promise<SlipView[]> {
  const { user, op, ipHash } = opts;
  const source = await getOwnedSlipRecord(user, opts.slipId);
  await enforceRateLimit({ userId: user.id, kind: "SLIP_EDIT", ...SLIP_EDIT_LIMIT });

  const now = new Date();
  const usable = source.selections.filter((s) => s.status === "OK" && marketOf(s) && s.bookmakerEvent && s.kickoffAt > now);
  if (usable.length === 0) throw new AppError("BAD_REQUEST", "This slip has no games that can still be booked.");

  const { groups } = applyEdit(
    usable.map((s) => ({ position: s.position, odds: s.odds === null ? null : Number(s.odds) })),
    op,
  );
  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) throw new AppError("BAD_REQUEST", "That would leave no games on the slip. Try a different setting.");

  const byPosition = new Map(usable.map((s) => [s.position, s]));
  const adapter = getAdapter(source.bookmaker.slug as BookmakerSlug);
  const kind = op.type === "split" ? "SPLIT" : "EDITED";
  const book = opts.book && adapter.capabilities.createCode;
  const meta = { op: op.type, sourceSlipId: source.id, groups: nonEmpty.length, booked: book };

  try {
    const results: SlipView[] = [];
    for (const group of nonEmpty) {
      const picks = group.map((p) => byPosition.get(p)!);
      let code: string | null = null;
      let expiresAt: Date | null = null;
      if (book) {
        const created = await adapter
          .createCode(picks.map((s) => ({ eventExternalId: s.bookmakerEvent!.externalId, market: marketOf(s)! })))
          .catch((err) => {
            throw asBookmakerError(err, adapter.slug, "createCode");
          });
        code = created.code;
        expiresAt = created.expiresAt;
      }
      const drafts: DraftSelection[] = picks.map((s, i) => ({
        position: i + 1,
        event: { externalId: s.bookmakerEvent!.externalId, home: s.homeTeam, away: s.awayTeam, kickoffAt: s.kickoffAt, competition: s.competition },
        market: marketOf(s),
        odds: s.odds === null ? null : Number(s.odds),
        raw: (s.raw as RawMarket | null) ?? null,
        status: "OK",
      }));
      const saved = await saveSlip({ userId: user.id, bookmakerId: source.bookmaker.id, kind, code, parentSlipId: source.id, expiresAt, selections: drafts });
      results.push(await withLogos(toSlipView(saved)));
    }
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_EDIT", success: true, meta });
    return results;
  } catch (err) {
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_EDIT", success: false, errorCode: err instanceof AppError ? err.code : "INTERNAL", meta });
    throw err;
  }
}
