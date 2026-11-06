import { ok, route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { specialSlipByReference } from "@/lib/services/special-picks";

export const dynamic = "force-dynamic";

/**
 * One published slip by its public reference.
 *
 * Public, because this is what a shared link resolves to - including for the website, which runs on
 * Cloudflare and cannot reach the database, so its share page reads through here like every other
 * public page.
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ reference: string }> }) => {
  const { reference } = await ctx.params;
  if (!/^[A-Za-z0-9-]{3,32}$/.test(reference)) throw new AppError("NOT_FOUND", "Slip not found.");

  const slip = await specialSlipByReference(reference);
  if (!slip) throw new AppError("NOT_FOUND", "Slip not found.");
  return ok({ slip });
});
