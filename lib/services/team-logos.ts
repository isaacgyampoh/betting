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

/** Stores crests seen in fixture lists. Best effort: never breaks the caller. */
export async function rememberLogos(matches: MatchSummary[]): Promise<void> {
  try {
    const aliases = await getAliasIndex();
    const rows = new Map<string, { key: string; name: string; logoUrl: string }>();
    for (const m of matches) {
      for (const t of [m.home, m.away]) {
        if (t.logo) rows.set(logoKey(t.name, aliases), { key: logoKey(t.name, aliases), name: t.name, logoUrl: t.logo });
      }
    }
    if (rows.size) await db.teamLogo.createMany({ data: [...rows.values()], skipDuplicates: true });
  } catch (err) {
    logger.warn("logos.remember_failed", { err });
  }
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
