import "server-only";
import { db } from "@/lib/db";
import { getAdapter, isBookmakerSlug } from "@/lib/bookmakers/registry";
import type { BookmakerSlug } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";

export type BookmakerListing = {
  slug: string;
  name: string;
  /** We can open a booking code the user pastes from here. */
  canLoad: boolean;
  /** We can book a new code here, which is what converting *to* this bookmaker needs. */
  canBook: boolean;
};

/**
 * Bookmakers that are enabled in the DB and have an adapter, each saying what it can really do.
 * The UI uses this so it never offers a conversion that is bound to fail: a bookmaker we cannot book
 * at is shown as coming soon rather than as a target.
 */
export async function listEnabledBookmakers(): Promise<BookmakerListing[]> {
  const rows = await db.bookmaker.findMany({ where: { isEnabled: true }, orderBy: { name: "asc" } });
  return rows
    .filter((b): b is typeof b & { slug: BookmakerSlug } => isBookmakerSlug(b.slug))
    .map((b) => {
      const { capabilities } = getAdapter(b.slug);
      return { slug: b.slug, name: b.name, canLoad: capabilities.loadCode, canBook: capabilities.createCode };
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
