import "server-only";
import { db } from "@/lib/db";
import { AWAITING_SETUP, REFUSED_BY_BOOKMAKER, getAdapter, isBookmakerSlug } from "@/lib/bookmakers/registry";
import type { BookmakerSlug } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";

export type BookmakerListing = {
  slug: string;
  name: string;
  /** We can open a booking code the user pastes from here. */
  canLoad: boolean;
  /** We can book a new code here, which is what converting *to* this bookmaker needs. */
  canBook: boolean;
  /**
   * Why this bookmaker is unavailable, when the reason is not that we never built it.
   *
   * Null means either it works, or it has no authorised integration. A string means the
   * integration is finished and the bookmaker is refusing our servers - which the user needs
   * told differently, because their code is fine.
   */
  refusedReason?: string | null;
  /** Which of the four states below this bookmaker is in. */
  status?: BookmakerStatus;
  /** One sentence explaining that status, for any state that is not simply "available". */
  statusNote?: string | null;
  /** Where this bookmaker operates, as a hint rather than a promise. */
  country?: string | null;
};

/**
 * What a user can actually expect from a destination.
 *
 * Four states rather than a boolean, because "it does not work" covers four different situations
 * and only one of them is ours to fix:
 *
 *   available  - a booking code has genuinely been issued and read back.
 *   setup      - the integration exists and works, and needs configuration or authorisation that
 *                is ours to supply.
 *   unavailable- the integration is finished and the bookmaker itself is refusing us. Theirs to
 *                lift, not ours to work around.
 *   unsupported- no authorised integration route has been found. Research, not a bug.
 */
export const BOOKMAKER_STATUSES = ["available", "setup", "unavailable", "unsupported"] as const;
export type BookmakerStatus = (typeof BOOKMAKER_STATUSES)[number];

/**
 * Bookmakers that are enabled in the DB and have an adapter, each saying what it can really do.
 * The UI uses this so it never offers a conversion that is bound to fail: a bookmaker we cannot book
 * at is shown as coming soon rather than as a target.
 */
function statusOf(slug: BookmakerSlug, canLoad: boolean, canBook: boolean): BookmakerStatus {
  if (canLoad && canBook) return "available";
  if (REFUSED_BY_BOOKMAKER[slug]) return "unavailable";
  if (AWAITING_SETUP[slug]) return "setup";
  return "unsupported";
}

export async function listEnabledBookmakers(): Promise<BookmakerListing[]> {
  const rows = await db.bookmaker.findMany({ where: { isEnabled: true }, orderBy: { name: "asc" } });
  return rows
    .filter((b): b is typeof b & { slug: BookmakerSlug } => isBookmakerSlug(b.slug))
    .map((b) => {
      const { capabilities } = getAdapter(b.slug);
      return {
        slug: b.slug,
        name: b.name,
        canLoad: capabilities.loadCode,
        canBook: capabilities.createCode,
        // Why it is unavailable, when the reason is not "we have not built it". A bookmaker whose
        // own servers are turning us away is a different thing from one with no integration, and
        // the screen should not tell somebody holding a perfectly good code that it is unsupported.
        refusedReason: REFUSED_BY_BOOKMAKER[b.slug] ?? null,
        status: statusOf(b.slug, capabilities.loadCode, capabilities.createCode),
        statusNote: REFUSED_BY_BOOKMAKER[b.slug] ?? AWAITING_SETUP[b.slug] ?? null,
        country: b.country ?? null,
      };
    });
}

/** Bookmakers a slip can be converted to right now. */
export async function listConvertTargets(): Promise<BookmakerListing[]> {
  return (await listEnabledBookmakers()).filter((b) => b.canBook);
}

export async function requireEnabledBookmaker(slug: string) {
  const row = await db.bookmaker.findUnique({ where: { slug } });
  if (!row || !row.isEnabled || !isBookmakerSlug(slug)) {
    throw new AppError("BAD_REQUEST", "That bookmaker isn't supported yet.");
  }
  return row;
}
