import "server-only";
import { cachedGet } from "@/lib/bookmakers/live/cached-get";
import { betradarMarketName, mapBetradarMarket, unmapBetradarMarket } from "@/lib/bookmakers/formats/betradar-format";
import type {
  BookmakerEventInfo,
  CreateCodeSelection,
  CreatedCode,
  EventMarkets,
  EventStatus,
  LoadedSelection,
  LoadedSlip,
  RawMarket,
} from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bestMatch } from "@/lib/matching/similarity";

// MSport Ghana, live.
//
// MSport runs the same platform as SportyBet (both leak `com.hopegaming.*` class names), so it uses
// the same Sportradar event ids and the same Betradar market/outcome ids. That is what makes real
// conversion between the two possible: a pick found on one can be booked on the other by id, and
// the only thing that differs is the price.
//
// Verified 2026-10-01 by booking a code and reading it back:
//
//   GET  /api/gh/facts-center/query/frontend/all-matches/next-7-days?sportId=&pageSize=&pageNum=
//   GET  /api/gh/facts-center/query/frontend/match/detail?eventId={sr:match:N}
//   GET  /api/gh/orders/real-sports/order/share/{code}
//   POST /api/gh/orders/real-sports/order/share
//
// The field names differ from SportyBet's in small, easy-to-miss ways: `markets[].id` is a **number**
// here, the line is in `specifiers` (plural), and labels are `description` rather than `desc`/`name`.

const BASE_URL = "https://www.msport.com/api/gh/";
const FACTS = "facts-center/query/frontend/";
const SHARE = "orders/real-sports/order/share";
const FOOTBALL = "sr:sport:1";

// `operId` identifies the country operator; 3 is Ghana. Without it the facts-center refuses.
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  referer: "https://www.msport.com/gh/",
  operId: "3",
};

const BIZ_OK = 10000;
const BIZ_INVALID = 19000;
const BIZ_EXPIRED = 19100;

type MsOutcome = { id: string; description?: string; odds?: string; probability?: string; isActive?: number };
/** `id` is a number here, and the line lives in `specifiers`. */
type MsMarket = { id: number | string; specifiers?: string; description?: string; status?: number; outcomes?: MsOutcome[] };
type MsEvent = {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  startTime: number;
  status?: number;
  eventMatchStatus?: string;
  statusDescription?: string | null;
  tournament?: string | null;
  category?: string | null;
  markets?: MsMarket[];
};

type Envelope<T> = { bizCode: number; message?: string; innerMsg?: string; data?: T };
type FixturesData = { events?: MsEvent[]; matchesCount?: number };
type ShareData = {
  shareCode?: string;
  originalSelectionCount?: number;
  /** One entry per picked market: the event, the market and the chosen outcome. */
  bettableBetSlip?: { event?: MsEvent; market?: MsMarket; outcome?: MsOutcome }[];
};

function unwrap<T>(res: Envelope<T>, context: string): T {
  // The facts-center wraps 404s *inside* a 10000 envelope, so a successful bizCode is not enough.
  const data = res.data as (T & { status?: number; error?: string }) | undefined;
  if (res.bizCode === BIZ_OK && data !== undefined && data !== null && data.error === undefined) return data;
  logger.warn("msport.biz_error", { context, bizCode: res.bizCode, message: res.innerMsg ?? res.message, error: data?.error });
  throw new AppError("BOOKMAKER_UNAVAILABLE", "MSport couldn't give us that right now. Please try again in a moment.");
}

function statusOf(e: MsEvent): EventStatus {
  const label = (e.eventMatchStatus ?? "").toLowerCase();
  if (label.includes("end") || label.includes("finish") || label.includes("closed")) return "ENDED";
  if (label.includes("not start")) return "NOT_STARTED";
  return (e.status ?? 0) === 0 ? "NOT_STARTED" : "LIVE";
}

function toEventInfo(e: MsEvent): BookmakerEventInfo {
  return {
    externalId: e.eventId,
    home: e.homeTeam,
    away: e.awayTeam,
    kickoffAt: new Date(e.startTime),
    competition: e.tournament ?? null,
    country: e.category ?? null,
    status: statusOf(e),
  };
}

function toRawMarket(m: MsMarket, o: MsOutcome): RawMarket {
  const marketId = String(m.id);
  return {
    marketId,
    outcomeId: o.id,
    specifier: m.specifiers ?? "",
    marketName: m.description ?? betradarMarketName(marketId) ?? marketId,
    outcomeName: o.description,
  };
}

/** MSport's own margin-free probability, when it publishes one. Never synthesised. */
export function probabilityOf(o: MsOutcome): number | null {
  const p = Number(o.probability);
  return Number.isFinite(p) && p > 0 && p <= 1 ? p : null;
}

const isLiveOffer = (m: MsMarket, o: MsOutcome) => (m.status ?? 0) === 0 && (o.isActive ?? 1) === 1 && Number(o.odds) > 1;

// --- Fixtures and odds -------------------------------------------------------

export async function fetchEvent(eventId: string): Promise<MsEvent> {
  const res = await cachedGet<Envelope<MsEvent>>({
    scope: "msport",
    baseUrl: BASE_URL,
    endpoint: `${FACTS}match/detail`,
    params: { eventId },
    ttlSeconds: 30,
    headers: HEADERS,
    timeoutMs: 15_000,
    cacheable: (p) => (p as Envelope<MsEvent>).bizCode === BIZ_OK && !!(p as Envelope<MsEvent>).data?.eventId,
  });
  return unwrap(res, "event");
}

export async function getEventMarkets(eventId: string): Promise<EventMarkets> {
  const event = await fetchEvent(eventId);
  const offers: EventMarkets["offers"] = [];
  for (const m of event.markets ?? []) {
    for (const o of m.outcomes ?? []) {
      if (!isLiveOffer(m, o)) continue;
      const raw = toRawMarket(m, o);
      offers.push({ raw, market: mapBetradarMarket(raw), odds: Number(o.odds) });
    }
  }
  return { event: toEventInfo(event), offers };
}

/** Upcoming football, for matching a fixture we hold against MSport's own listing. */
export async function listUpcoming({ pages = 2, pageSize = 50 } = {}): Promise<BookmakerEventInfo[]> {
  const events: BookmakerEventInfo[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await cachedGet<Envelope<FixturesData>>({
      scope: "msport",
      baseUrl: BASE_URL,
      endpoint: `${FACTS}all-matches/next-7-days`,
      params: { sportId: FOOTBALL, pageSize, pageNum: page },
      ttlSeconds: 180,
      headers: HEADERS,
      timeoutMs: 20_000,
      cacheable: (p) => (p as Envelope<FixturesData>).bizCode === BIZ_OK,
    });
    const batch = unwrap(res, "upcoming").events ?? [];
    if (!batch.length) break;
    events.push(...batch.map(toEventInfo));
  }
  return events;
}

export async function searchEvent(home: string, away: string, kickoff: Date): Promise<BookmakerEventInfo[]> {
  const candidates = await listUpcoming({ pages: 3 });
  const hit = bestMatch({ home, away, kickoffAt: kickoff }, candidates);
  return hit ? [hit.candidate] : [];
}

// --- Booking codes -----------------------------------------------------------

function selectionsFromSlip(entries: ShareData["bettableBetSlip"]): LoadedSelection[] {
  const out: LoadedSelection[] = [];
  for (const entry of entries ?? []) {
    if (!entry.event || !entry.market || !entry.outcome) continue;
    const raw = toRawMarket(entry.market, entry.outcome);
    const odds = Number(entry.outcome.odds);
    out.push({
      event: toEventInfo(entry.event),
      raw,
      market: mapBetradarMarket(raw),
      odds: Number.isFinite(odds) && odds > 1 ? odds : null,
    });
  }
  return out;
}

export async function loadCode(code: string): Promise<LoadedSlip> {
  const res = await cachedGet<Envelope<ShareData>>({
    scope: "msport",
    baseUrl: BASE_URL,
    endpoint: `${SHARE}/${encodeURIComponent(code)}`,
    ttlSeconds: 20,
    headers: HEADERS,
    timeoutMs: 15_000,
    cacheable: (p) => (p as Envelope<ShareData>).bizCode === BIZ_OK,
  });

  if (res.bizCode === BIZ_EXPIRED) throw new AppError("EXPIRED_CODE", `Booking code ${code} has expired on MSport.`);
  if (res.bizCode === BIZ_INVALID) throw new AppError("INVALID_CODE", `MSport doesn't recognise booking code ${code}.`);
  if (res.bizCode !== BIZ_OK || !res.data) {
    logger.warn("msport.share_biz_error", { code, bizCode: res.bizCode, message: res.innerMsg ?? res.message });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "MSport couldn't open that code right now. Please try again in a moment.");
  }

  const selections = selectionsFromSlip(res.data.bettableBetSlip);
  if (!selections.length) {
    // An empty slip here is a code with nothing left on it, not a reader problem: MSport returns
    // bizCode 10000 with an empty list for a code whose games have all gone.
    logger.warn("msport.share_empty", { code, originalSelectionCount: res.data.originalSelectionCount ?? null });
    throw new AppError("EXPIRED_CODE", `Booking code ${code} has no games left on MSport.`);
  }
  return { bookmaker: "msport", code, selections, expiresAt: null };
}

export async function createCode(selections: CreateCodeSelection[]): Promise<CreatedCode> {
  if (!selections.length) throw new AppError("BAD_REQUEST", "There are no picks to book.");

  const payload = selections.map(({ eventExternalId, market, raw: given }) => {
    const raw = given ?? (market ? unmapBetradarMarket(market) : null);
    if (!raw) {
      const what = market ? `${market.type} (${market.period})` : "that market";
      throw new AppError("BAD_REQUEST", `MSport doesn't offer ${what}, so this slip can't be booked there.`);
    }
    return {
      eventId: eventExternalId,
      marketId: raw.marketId,
      outcomeId: raw.outcomeId,
      ...(raw.specifier ? { specifier: raw.specifier } : {}),
      sportId: FOOTBALL,
    };
  });

  let res: Response;
  try {
    res = await fetch(new URL(SHARE, BASE_URL), {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json", accept: "application/json", origin: "https://www.msport.com" },
      body: JSON.stringify({ selections: payload }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    logger.error("msport.create_failed", { error: String(error) });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "We couldn't reach MSport to book that slip. Please try again in a moment.");
  }

  if (!res.ok) {
    logger.error("msport.create_http_error", { status: res.status });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "MSport wouldn't book that slip just now. Please try again in a moment.");
  }

  const body = (await res.json()) as Envelope<ShareData>;
  if (body.bizCode !== BIZ_OK || !body.data?.shareCode) {
    const message = body.innerMsg ?? body.message ?? "";
    logger.warn("msport.create_rejected", { bizCode: body.bizCode, message, picks: payload.length });
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      message ? `MSport wouldn't book this slip: ${message}` : "MSport wouldn't book this slip. A game may have started.",
    );
  }

  // MSport answers 10000 with a code even when it accepted nothing: posting an empty selection list
  // still returns a (useless) code, and `originalSelectionCount` reads 0 even for good bookings, so
  // it cannot be used to tell them apart. Read the code back instead — one extra request on a rare
  // operation is a fair price for never handing someone a code that turns out to be empty.
  const code = body.data.shareCode;
  const check = await loadCode(code).catch((error: unknown) => {
    logger.warn("msport.create_verify_failed", { code, error: String(error) });
    return null;
  });
  if (!check) {
    throw new AppError("BOOKMAKER_UNAVAILABLE", "MSport gave us a code but then couldn't open it. Please try again in a moment.");
  }
  if (check.selections.length < payload.length) {
    logger.warn("msport.create_partial", { code, accepted: check.selections.length, sent: payload.length });
  }

  return { code, expiresAt: null };
}
