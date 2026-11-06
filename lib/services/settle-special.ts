import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { statsProvider } from "@/lib/services/stats";
import { actualFor, type SpecialMarket } from "@/lib/special-picks/markets";

/**
 * Grading published special picks from the match's own statistics.
 *
 * Three rules, each the answer to a way this could quietly go wrong:
 *
 *   * **Only settle what can be read.** A finished match whose statistics the provider has not
 *     published is left pending, not guessed and not marked lost. `actualFor` returns null rather
 *     than zero for a missing count, and a corners line graded against zero would mark every over
 *     as lost - silently, plausibly, and permanently in the published record.
 *   * **Never revisit a settled pick.** Only PENDING rows are touched. A selection that has been
 *     graded stays graded even if the provider later revises a figure; the record is a record.
 *   * **Void means void.** A postponed or cancelled match is void, which is different from a
 *     match that was played and has no statistics yet.
 *
 * A pick still pending three days after kick-off is voided with the reason recorded. Leaving it
 * pending for ever would keep it out of the win rate, which is the quiet way a published record
 * flatters itself.
 */

/** Long enough for a match and stoppage time to be comfortably over. */
const SETTLE_AFTER_MS = 3 * 60 * 60_000;

/** After this, a pick nobody can grade is void rather than permanently pending. */
const ABANDON_AFTER_MS = 3 * 24 * 60 * 60_000;

export async function settleSpecialPicks(now = new Date()): Promise<{ settled: number; voided: number; waiting: number; slips: number }> {
  const due = await db.specialPick.findMany({
    where: { status: "PENDING", kickoffAt: { lt: new Date(now.getTime() - SETTLE_AFTER_MS) } },
    orderBy: { kickoffAt: "asc" },
    take: 50,
  });

  const provider = statsProvider();
  let settled = 0;
  let voided = 0;
  let waiting = 0;

  for (const pick of due) {
    const match = await provider.fixture(pick.statsFixtureId).catch(() => null);

    if (match && (match.status === "POSTPONED" || match.status === "CANCELLED")) {
      await db.specialPick.update({
        where: { id: pick.id },
        data: { status: "VOID", settledAt: now },
      });
      voided++;
      continue;
    }

    const playedOut = match?.status === "FINISHED";
    const stats = playedOut ? await provider.statistics(pick.statsFixtureId, match.home.id, true).catch(() => []) : [];

    const market: SpecialMarket = {
      kind: pick.marketKind as SpecialMarket["kind"],
      side: pick.marketSide as SpecialMarket["side"],
      period: "FT",
    };
    const actual = playedOut ? actualFor(market, stats) : null;

    if (actual === null) {
      // Too old to keep waiting for: void it and say so, rather than letting it sit outside the
      // record for ever.
      if (now.getTime() - pick.kickoffAt.getTime() > ABANDON_AFTER_MS) {
        await db.specialPick.update({ where: { id: pick.id }, data: { status: "VOID", settledAt: now } });
        logger.warn("special.voided_unsettleable", { id: pick.id, fixtureId: pick.statsFixtureId, status: match?.status });
        voided++;
      } else {
        waiting++;
      }
      continue;
    }

    const line = Number(pick.line);
    const won = pick.outcome === "OVER" ? actual > line : actual < line;

    await db.specialPick.update({
      where: { id: pick.id },
      data: { status: won ? "WON" : "LOST", actual, settledAt: now },
    });
    settled++;
  }

  const slips = await settleSpecialSlips(now);

  if (settled || voided || waiting || slips) logger.info("special.settled", { settled, voided, waiting, slips });
  return { settled, voided, waiting, slips };
}

/**
 * Closes a slip once every one of its legs is in.
 *
 * Derived from the legs rather than tracked alongside them, so the slip can never disagree with
 * what it is made of. The rules are a bookmaker's: every surviving leg has to win, a void leg
 * drops out rather than sinking the slip, a slip whose legs all voided is void, and a slip is
 * still running while any leg is.
 */
export async function settleSpecialSlips(now = new Date()): Promise<number> {
  const open = await db.specialSlip.findMany({
    where: { status: "PENDING" },
    include: { picks: { select: { status: true } } },
    take: 50,
  });

  let closed = 0;
  for (const slip of open) {
    if (!slip.picks.length || slip.picks.some((p) => p.status === "PENDING")) continue;

    const live = slip.picks.filter((p) => p.status !== "VOID");
    const status = !live.length ? "VOID" : live.every((p) => p.status === "WON") ? "WON" : "LOST";

    await db.specialSlip.update({ where: { id: slip.id }, data: { status, settledAt: now } });
    closed++;
  }

  if (closed) logger.info("special.slips_settled", { closed });
  return closed;
}

/**
 * Re-reads the price on selections that have not kicked off yet.
 *
 * The published price is never touched. A bookmaker moving a line after publication is
 * information, not a correction, and rewriting `odds` would quietly improve the record's apparent
 * value and make the profit figure a fiction - so a new price is a new row in the history and the
 * original stands.
 */
export async function refreshSpecialOdds(now = new Date()): Promise<{ checked: number; moved: number }> {
  const upcoming = await db.specialPick.findMany({
    where: { status: "PENDING", kickoffAt: { gt: now }, bookmaker: { not: null } },
    take: 10,
  });
  if (!upcoming.length) return { checked: 0, moved: 0 };

  const { listUpcomingWithOffers } = await import("@/lib/bookmakers/live/sportybet");
  const { candidatesFrom, dedupe } = await import("@/lib/special-picks/candidates");

  const fixtures = await listUpcomingWithOffers({ hours: 36, pages: 3 }).catch(() => []);
  const priced = dedupe(candidatesFrom("sportybet", fixtures));

  let checked = 0;
  let moved = 0;
  for (const pick of upcoming) {
    const match = priced.find(
      (c) =>
        c.event.home === pick.homeTeam &&
        c.event.away === pick.awayTeam &&
        c.market.kind === pick.marketKind &&
        c.market.side === pick.marketSide &&
        c.outcome === pick.outcome &&
        Math.abs(c.line - Number(pick.line)) < 1e-9,
    );
    if (!match) continue;
    checked++;

    const latest = await db.specialPickOdds.findFirst({ where: { pickId: pick.id }, orderBy: { checkedAt: "desc" } });
    if (latest && Math.abs(Number(latest.odds) - match.odds) < 1e-9) continue;

    await db.specialPickOdds.create({ data: { pickId: pick.id, bookmaker: match.bookmaker, odds: match.odds, line: match.line } });
    moved++;
  }

  // The slip says when its prices were last checked, so a morning price is not read as a price now.
  if (checked) {
    const slipIds = [...new Set(upcoming.map((p) => p.slipId).filter((id): id is string => id !== null))];
    if (slipIds.length) await db.specialSlip.updateMany({ where: { id: { in: slipIds } }, data: { lastVerifiedAt: now } });
  }

  if (moved) logger.info("special.odds_moved", { checked, moved });
  return { checked, moved };
}
