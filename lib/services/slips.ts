import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthUser } from "@/lib/auth";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { BookmakerSlug, LoadedSlip } from "@/lib/bookmakers/types";
import type { Market } from "@/lib/markets/types";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireEnabledBookmaker } from "@/lib/services/bookmakers";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import { buildWarnings, toSelectionView, totalOdds, type SlipSummary, type SlipView } from "@/lib/slips/view";

export const SLIP_LOAD_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const CODE_CACHE_TTL_MS = 5 * 60_000;

// --- Code cache (Postgres) --------------------------------------------------

type CachedSlip = Omit<LoadedSlip, "selections" | "expiresAt"> & {
  expiresAt: string | null;
  selections: (Omit<LoadedSlip["selections"][number], "event"> & {
    event: Omit<LoadedSlip["selections"][number]["event"], "kickoffAt"> & { kickoffAt: string };
  })[];
};

function toCache(slip: LoadedSlip): CachedSlip {
  return {
    ...slip,
    expiresAt: slip.expiresAt?.toISOString() ?? null,
    selections: slip.selections.map((s) => ({ ...s, event: { ...s.event, kickoffAt: s.event.kickoffAt.toISOString() } })),
  };
}

function fromCache(c: CachedSlip): LoadedSlip {
  return {
    ...c,
    expiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
    selections: c.selections.map((s) => ({ ...s, event: { ...s.event, kickoffAt: new Date(s.event.kickoffAt) } })),
  };
}

async function loadWithCache(bookmakerId: string, slug: BookmakerSlug, code: string) {
  const hit = await db.codeCache.findUnique({ where: { bookmakerId_code: { bookmakerId, code } } });
  if (hit && hit.expiresAt > new Date()) {
    return { slip: fromCache(hit.payload as unknown as CachedSlip), cached: true };
  }

  let slip: LoadedSlip;
  try {
    slip = await getAdapter(slug).loadCode(code);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error("bookmaker.load_failed", { bookmaker: slug, code, err });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "The bookmaker isn't responding right now. Please try again shortly.", { cause: err });
  }

  const payload = toCache(slip) as unknown as Prisma.InputJsonValue;
  const expiresAt = new Date(Date.now() + CODE_CACHE_TTL_MS);
  await db.codeCache.upsert({
    where: { bookmakerId_code: { bookmakerId, code } },
    create: { bookmakerId, code, payload, expiresAt },
    update: { payload, expiresAt, fetchedAt: new Date() },
  });
  return { slip, cached: false };
}

// --- Persistence -------------------------------------------------------------

const slipInclude = {
  bookmaker: { select: { slug: true, name: true } },
  selections: { orderBy: { position: "asc" }, include: { bookmakerEvent: { select: { externalId: true } } } },
} satisfies Prisma.SlipInclude;

type SlipWithSelections = Prisma.SlipGetPayload<{ include: typeof slipInclude }>;

function toSlipView(slip: SlipWithSelections): SlipView {
  const now = new Date();
  const selections = slip.selections.map((s) =>
    toSelectionView(
      {
        position: s.position,
        eventExternalId: s.bookmakerEvent?.externalId ?? null,
        home: s.homeTeam,
        away: s.awayTeam,
        competition: s.competition,
        kickoffAt: s.kickoffAt,
        market:
          s.marketType && s.outcome
            ? { type: s.marketType, period: s.period, outcome: s.outcome, line: s.line === null ? null : Number(s.line) }
            : null,
        rawMarketName: s.rawMarketName,
        rawOutcomeName: s.rawOutcomeName,
        odds: s.odds === null ? null : Number(s.odds),
      },
      now,
    ),
  );
  return {
    id: slip.id,
    bookmaker: slip.bookmaker,
    code: slip.bookingCode,
    kind: slip.kind,
    totalOdds: slip.totalOdds === null ? null : Number(slip.totalOdds),
    selectionCount: selections.length,
    expiresAt: slip.expiresAt?.toISOString() ?? null,
    createdAt: slip.createdAt.toISOString(),
    selections,
    warnings: buildWarnings(selections),
  };
}

async function saveLoadedSlip(userId: string, bookmakerId: string, loaded: LoadedSlip) {
  // Remember each bookmaker event; Milestone 3 links them to canonical events for conversion.
  const bmEvents = await Promise.all(
    loaded.selections.map(({ event }) =>
      db.bookmakerEvent.upsert({
        where: { bookmakerId_externalId: { bookmakerId, externalId: event.externalId } },
        create: {
          bookmakerId,
          externalId: event.externalId,
          homeName: event.home,
          awayName: event.away,
          kickoffAt: event.kickoffAt,
          competition: event.competition,
        },
        update: { homeName: event.home, awayName: event.away, kickoffAt: event.kickoffAt, competition: event.competition },
        select: { id: true },
      }),
    ),
  );

  return db.slip.create({
    data: {
      userId,
      bookmakerId,
      kind: "LOADED",
      bookingCode: loaded.code,
      expiresAt: loaded.expiresAt,
      totalOdds: totalOdds(loaded.selections.map((s) => s.odds)),
      selections: {
        create: loaded.selections.map((s, i) => ({
          position: i + 1,
          bookmakerEventId: bmEvents[i].id,
          homeTeam: s.event.home,
          awayTeam: s.event.away,
          kickoffAt: s.event.kickoffAt,
          competition: s.event.competition,
          ...marketColumns(s.market),
          odds: s.odds,
          rawMarketName: s.raw.marketName ?? s.raw.marketId,
          rawOutcomeName: s.raw.outcomeName ?? s.raw.outcomeId,
          raw: s.raw as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    include: slipInclude,
  });
}

function marketColumns(m: Market | null) {
  return m ? { marketType: m.type, period: m.period, outcome: m.outcome, line: m.line } : { marketType: null, outcome: null };
}

// --- Public API --------------------------------------------------------------

export async function loadSlip(opts: { user: AuthUser; bookmaker: BookmakerSlug; code: string; ipHash: string | null }) {
  const { user, ipHash } = opts;
  const bookmaker = await requireEnabledBookmaker(opts.bookmaker);
  await enforceRateLimit({ userId: user.id, kind: "SLIP_LOAD", ...SLIP_LOAD_LIMIT });

  const code = getAdapter(opts.bookmaker).normalizeCode(opts.code);
  const meta = { bookmaker: opts.bookmaker, code: code ?? opts.code.slice(0, 40) };

  try {
    if (!code) throw new AppError("INVALID_CODE", "That doesn't look like a booking code. Check it and try again.");
    const { slip, cached } = await loadWithCache(bookmaker.id, opts.bookmaker, code);
    const saved = await saveLoadedSlip(user.id, bookmaker.id, slip);
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_LOAD", success: true, meta: { ...meta, cached } });
    return toSlipView(saved);
  } catch (err) {
    const errorCode = err instanceof AppError ? err.code : "INTERNAL";
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_LOAD", success: false, errorCode, meta });
    if (err instanceof AppError) logger.info("slips.load_rejected", { ...meta, errorCode });
    throw err;
  }
}

export async function getSlip(user: AuthUser, id: string): Promise<SlipView> {
  const slip = await db.slip.findFirst({ where: { id, userId: user.id }, include: slipInclude });
  if (!slip) throw new AppError("NOT_FOUND", "Slip not found.");
  return toSlipView(slip);
}

export async function listRecentSlips(user: AuthUser, limit = 10): Promise<SlipSummary[]> {
  const slips = await db.slip.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { bookmaker: { select: { slug: true, name: true } }, _count: { select: { selections: true } } },
  });
  return slips.map((s) => ({
    id: s.id,
    bookmaker: s.bookmaker,
    code: s.bookingCode,
    totalOdds: s.totalOdds === null ? null : Number(s.totalOdds),
    selectionCount: s._count.selections,
    createdAt: s.createdAt.toISOString(),
  }));
}
