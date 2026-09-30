import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthUser } from "@/lib/auth";
import { getAdapter } from "@/lib/bookmakers/registry";
import type { BookmakerSlug, LoadedSlip, RawMarket } from "@/lib/bookmakers/types";
import type { Market } from "@/lib/markets/types";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { SlipKind } from "@/lib/generated/prisma/enums";
import { requireEnabledBookmaker } from "@/lib/services/bookmakers";
import { logosFor } from "@/lib/services/team-logos";
import { enforceRateLimit, logUsage } from "@/lib/services/usage";
import {
  buildWarnings,
  toSelectionView,
  totalOdds,
  type SelectionStatus,
  type SlipSummary,
  type SlipView,
} from "@/lib/slips/view";

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
    throw asBookmakerError(err, slug, "loadCode");
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

/** AppErrors pass through; anything else from an adapter becomes a logged BOOKMAKER_UNAVAILABLE. */
export function asBookmakerError(err: unknown, slug: string, op: string): AppError {
  if (err instanceof AppError) return err;
  logger.error("bookmaker.call_failed", { bookmaker: slug, op, err });
  return new AppError("BOOKMAKER_UNAVAILABLE", "The bookmaker isn't responding right now. Please try again shortly.", {
    cause: err,
  });
}

// --- Persistence -------------------------------------------------------------

export const slipInclude = {
  bookmaker: { select: { id: true, slug: true, name: true } },
  selections: { orderBy: { position: "asc" }, include: { bookmakerEvent: { select: { externalId: true } } } },
  parent: {
    select: {
      id: true,
      bookingCode: true,
      bookmaker: { select: { slug: true, name: true } },
      selections: { select: { position: true, odds: true } },
    },
  },
} satisfies Prisma.SlipInclude;

export type SlipRecord = Prisma.SlipGetPayload<{ include: typeof slipInclude }>;

export function marketOf(s: { marketType: Market["type"] | null; period: Market["period"]; outcome: string | null; line: Prisma.Decimal | null }): Market | null {
  return s.marketType && s.outcome
    ? { type: s.marketType, period: s.period, outcome: s.outcome, line: s.line === null ? null : Number(s.line) }
    : null;
}

/** Adds club crests to slip views (one query for all teams). */
export async function withLogos<T extends SlipView | SlipView[]>(views: T): Promise<T> {
  const list: SlipView[] = Array.isArray(views) ? views : [views as SlipView];
  const logos = await logosFor([...new Set(list.flatMap((v) => v.selections.flatMap((s) => [s.home, s.away])))]);
  for (const v of list) {
    for (const s of v.selections) {
      s.homeLogo = logos.get(s.home) ?? null;
      s.awayLogo = logos.get(s.away) ?? null;
    }
  }
  return views;
}

export function toSlipView(slip: SlipRecord): SlipView {
  const now = new Date();
  const parentOdds = new Map(slip.parent?.selections.map((p) => [p.position, p.odds === null ? null : Number(p.odds)]));
  const selections = slip.selections.map((s) =>
    toSelectionView(
      {
        position: s.position,
        eventExternalId: s.bookmakerEvent?.externalId ?? null,
        home: s.homeTeam,
        away: s.awayTeam,
        competition: s.competition,
        kickoffAt: s.kickoffAt,
        market: marketOf(s),
        rawMarketName: s.rawMarketName,
        rawOutcomeName: s.rawOutcomeName,
        odds: s.odds === null ? null : Number(s.odds),
        status: s.status as SelectionStatus,
        ...(slip.parent && slip.kind === "CONVERTED" ? { sourceOdds: parentOdds.get(s.position) ?? null } : {}),
      },
      now,
    ),
  );
  return {
    id: slip.id,
    bookmaker: { slug: slip.bookmaker.slug, name: slip.bookmaker.name },
    code: slip.bookingCode,
    kind: slip.kind,
    totalOdds: slip.totalOdds === null ? null : Number(slip.totalOdds),
    selectionCount: selections.filter((s) => s.status === "OK").length,
    expiresAt: slip.expiresAt?.toISOString() ?? null,
    createdAt: slip.createdAt.toISOString(),
    parent: slip.parent ? { id: slip.parent.id, bookmaker: slip.parent.bookmaker, code: slip.parent.bookingCode } : null,
    selections,
    warnings: buildWarnings(selections),
  };
}

/** A selection about to be saved. `event.externalId` is null when the game wasn't found on this bookmaker. */
export type DraftSelection = {
  position: number;
  event: { externalId: string | null; home: string; away: string; kickoffAt: Date; competition: string | null };
  market: Market | null;
  odds: number | null;
  raw: RawMarket | null;
  status: SelectionStatus;
};

export async function saveSlip(input: {
  userId: string;
  bookmakerId: string;
  kind: SlipKind;
  code: string | null;
  parentSlipId?: string | null;
  expiresAt: Date | null;
  selections: DraftSelection[];
}) {
  const { bookmakerId } = input;
  // Remember each bookmaker event; conversion links them to canonical events.
  const bmEventIds = await Promise.all(
    input.selections.map(({ event }) =>
      event.externalId
        ? db.bookmakerEvent
            .upsert({
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
            })
            .then((r) => r.id)
        : Promise.resolve(null),
    ),
  );

  const ok = input.selections.filter((s) => s.status === "OK");
  return db.slip.create({
    data: {
      userId: input.userId,
      bookmakerId,
      kind: input.kind,
      bookingCode: input.code,
      parentSlipId: input.parentSlipId ?? null,
      expiresAt: input.expiresAt,
      totalOdds: totalOdds(ok.map((s) => s.odds)),
      selections: {
        create: input.selections.map((s, i) => ({
          position: s.position,
          bookmakerEventId: bmEventIds[i],
          homeTeam: s.event.home,
          awayTeam: s.event.away,
          kickoffAt: s.event.kickoffAt,
          competition: s.event.competition,
          ...(s.market
            ? { marketType: s.market.type, period: s.market.period, outcome: s.market.outcome, line: s.market.line }
            : { marketType: null, outcome: null }),
          odds: s.odds,
          rawMarketName: s.raw ? (s.raw.marketName ?? s.raw.marketId) : null,
          rawOutcomeName: s.raw ? (s.raw.outcomeName ?? s.raw.outcomeId) : null,
          raw: s.raw ? (s.raw as unknown as Prisma.InputJsonValue) : undefined,
          status: s.status,
        })),
      },
    },
    include: slipInclude,
  });
}

export async function getOwnedSlipRecord(user: AuthUser, id: string): Promise<SlipRecord> {
  const slip = await db.slip.findFirst({ where: { id, userId: user.id }, include: slipInclude });
  if (!slip) throw new AppError("NOT_FOUND", "Slip not found.");
  return slip;
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
    const saved = await saveSlip({
      userId: user.id,
      bookmakerId: bookmaker.id,
      kind: "LOADED",
      code: slip.code,
      expiresAt: slip.expiresAt,
      selections: slip.selections.map((s, i) => ({
        position: i + 1,
        event: s.event,
        market: s.market,
        odds: s.odds,
        raw: s.raw,
        status: "OK",
      })),
    });
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_LOAD", success: true, meta: { ...meta, cached } });
    return withLogos(toSlipView(saved));
  } catch (err) {
    const errorCode = err instanceof AppError ? err.code : "INTERNAL";
    await logUsage({ userId: user.id, ipHash, kind: "SLIP_LOAD", success: false, errorCode, meta });
    if (err instanceof AppError) logger.info("slips.load_rejected", { ...meta, errorCode });
    throw err;
  }
}

export async function getSlip(user: AuthUser, id: string): Promise<SlipView> {
  return withLogos(toSlipView(await getOwnedSlipRecord(user, id)));
}

export async function listRecentSlips(user: AuthUser, limit = 10): Promise<SlipSummary[]> {
  const slips = await db.slip.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      bookmaker: { select: { slug: true, name: true } },
      _count: { select: { selections: { where: { status: "OK" } } } },
    },
  });
  return slips.map((s) => ({
    id: s.id,
    bookmaker: s.bookmaker,
    code: s.bookingCode,
    kind: s.kind,
    totalOdds: s.totalOdds === null ? null : Number(s.totalOdds),
    selectionCount: s._count.selections,
    createdAt: s.createdAt.toISOString(),
  }));
}
