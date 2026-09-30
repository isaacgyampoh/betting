import "server-only";
import { db } from "@/lib/db";
import { isBookmakerSlug } from "@/lib/bookmakers/registry";
import { AppError } from "@/lib/errors";

/** Bookmakers that are enabled in the DB and have an adapter. */
export async function listEnabledBookmakers() {
  const rows = await db.bookmaker.findMany({ where: { isEnabled: true }, orderBy: { name: "asc" } });
  return rows.filter((b) => isBookmakerSlug(b.slug)).map((b) => ({ slug: b.slug, name: b.name }));
}

export async function requireEnabledBookmaker(slug: string) {
  const row = await db.bookmaker.findUnique({ where: { slug } });
  if (!row || !row.isEnabled || !isBookmakerSlug(slug)) {
    throw new AppError("BAD_REQUEST", "That bookmaker isn't supported yet.");
  }
  return row;
}
