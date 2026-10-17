import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { normalizeTeamName } from "@/lib/matching/normalize";
import type { AliasIndex } from "@/lib/matching/similarity";
import type { MatchSummary } from "@/lib/stats/types";
import { getAliasIndex } from "@/lib/services/events";

/** Same key for "Man Utd" (bookmaker) and "Manchester United" (API-Football): the alias group. */
function logoKey(name: string, aliases: AliasIndex): string {
  const n = normalizeTeamName(name);
  return aliases.get(n) ?? n;
}

/**
 * Keys this isolate has already written, so the same crests are not offered to the database on
 * every request.
 *
 * A day's fixture list is about 3,300 teams, and all but a handful of them are already stored.
 * The insert below is `skipDuplicates`, so Postgres dutifully discarded all 3,300 and the caller
 * waited for it: measured at 362-1118ms of a 1.3s request, every request, for no new rows. The
 * insert never updated an existing crest anyway - that is what skipDuplicates means - so
 * remembering which keys have been sent loses nothing at all.
 *
 * Module scope, which on Workers lives as long as the isolate: the first request after a cold
 * start still pays, and the rest pay nothing. Unbounded growth is not a concern because the set
 * is bounded by the number of teams the provider has, and the isolate is discarded long before
 * that matters.
 */
const stored = new Set<string>();

/** Stores crests seen in fixture lists. Best effort: never breaks the caller. */
export async function rememberLogos(matches: MatchSummary[]): Promise<void> {
  try {
    const aliases = await getAliasIndex();
    const rows = new Map<string, { key: string; name: string; logoUrl: string }>();
    for (const m of matches) {
      for (const t of [m.home, m.away]) {
        if (!t.logo) continue;
        const key = logoKey(t.name, aliases);
        if (stored.has(key)) continue;
        rows.set(key, { key, name: t.name, logoUrl: t.logo });
      }
    }
    if (!rows.size) return;
    await db.teamLogo.createMany({ data: [...rows.values()], skipDuplicates: true });
    // Only after the write succeeded. Marking them first would lose a crest for the life of the
    // isolate if the insert threw.
    for (const key of rows.keys()) stored.add(key);
  } catch (err) {
    logger.warn("logos.remember_failed", { err });
  }
}

/** Lets a test start from a cold isolate. Not used in production. */
export function forgetRememberedLogos(): void {
  stored.clear();
}

/** Crest URLs for team names (any bookmaker spelling). Missing teams are simply absent. */
export async function logosFor(names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!names.length) return out;
  try {
    const aliases = await getAliasIndex();
    const keyOf = new Map(names.map((n) => [n, logoKey(n, aliases)]));
    const rows = await db.teamLogo.findMany({ where: { key: { in: [...new Set(keyOf.values())] } } });
    const byKey = new Map(rows.map((r) => [r.key, r.logoUrl]));
    for (const [name, key] of keyOf) {
      const url = byKey.get(key);
      if (url) out.set(name, url);
    }
  } catch (err) {
    logger.warn("logos.lookup_failed", { err });
  }
  return out;
}
