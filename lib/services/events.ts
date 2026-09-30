import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { normalizeTeamName } from "@/lib/matching/normalize";
import { buildAliasIndex, type AliasIndex } from "@/lib/matching/similarity";

const ALIAS_TTL_MS = 5 * 60_000;
let aliasCache: { index: AliasIndex; at: number } | null = null;

/** Built-in aliases plus DB aliases (including learned ones), cached per instance. */
export async function getAliasIndex(): Promise<AliasIndex> {
  if (aliasCache && Date.now() - aliasCache.at < ALIAS_TTL_MS) return aliasCache.index;
  const rows = await db.teamAlias.findMany({ select: { alias: true, team: { select: { name: true } } }, take: 20_000 });
  const index = buildAliasIndex(rows.map((r) => ({ alias: r.alias, canonical: r.team.name })));
  aliasCache = { index, at: Date.now() };
  return index;
}

async function findOrCreateTeam(name: string): Promise<string> {
  const normalized = normalizeTeamName(name);
  const alias = await db.teamAlias.findFirst({ where: { normalized }, select: { teamId: true } });
  if (alias) return alias.teamId;
  const existing = await db.team.findFirst({ where: { normalizedName: normalized }, select: { id: true } });
  if (existing) return existing.id;
  const team = await db.team.create({ data: { name, normalizedName: normalized }, select: { id: true } });
  await db.teamAlias.create({ data: { teamId: team.id, alias: name, normalized } });
  return team.id;
}

async function learnAlias(teamId: string, name: string) {
  const normalized = normalizeTeamName(name);
  const exists = await db.teamAlias.findFirst({ where: { normalized }, select: { id: true } });
  if (!exists) {
    await db.teamAlias.create({ data: { teamId, alias: name, normalized } });
    aliasCache = null;
    logger.info("matching.alias_learned", { alias: name, teamId });
  }
}

type Side = { bookmakerId: string; externalId: string; home: string; away: string; kickoffAt: Date; competition: string | null };

/**
 * Links two bookmakers' listings of the same game to one canonical event, and learns the
 * target's team spellings as aliases when the match was confident. Best effort: never throws.
 */
export async function linkMatchedEvents(pairs: { source: Side; target: Side; score: number }[]) {
  for (const { source, target, score } of pairs) {
    try {
      const [homeTeamId, awayTeamId] = await Promise.all([findOrCreateTeam(source.home), findOrCreateTeam(source.away)]);
      if (score >= 0.85) {
        await learnAlias(homeTeamId, target.home);
        await learnAlias(awayTeamId, target.away);
      }
      const event = await db.event.upsert({
        where: { homeTeamId_awayTeamId_kickoffAt: { homeTeamId, awayTeamId, kickoffAt: source.kickoffAt } },
        create: { homeTeamId, awayTeamId, kickoffAt: source.kickoffAt, competition: source.competition },
        update: {},
        select: { id: true },
      });
      await db.bookmakerEvent.updateMany({
        where: {
          OR: [
            { bookmakerId: source.bookmakerId, externalId: source.externalId },
            { bookmakerId: target.bookmakerId, externalId: target.externalId },
          ],
        },
        data: { eventId: event.id },
      });
    } catch (err) {
      logger.warn("matching.link_failed", { source: source.externalId, target: target.externalId, err });
    }
  }
}
