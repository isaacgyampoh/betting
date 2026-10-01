import "server-only";
import { cachedGet } from "@/lib/bookmakers/live/cached-get";
import { mapBetradarMarket, betradarMarketName } from "@/lib/bookmakers/formats/betradar-format";
import type {
  BookmakerEventInfo,
  EventMarkets,
  EventStatus,
  LoadedSelection,
  LoadedSlip,
  RawMarket,
} from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bestMatch } from "@/lib/matching/similarity";

// SportyBet Ghana, live.
//
// Endpoints below were found by probing the public site (no account, no login) and are recorded in
// docs/capturing-bookmaker-requests.md with the date they were verified:
//
//   GET /api/gh/factsCenter/event?eventId={id}&productId=3     one event, every market  (verified)
//   GET /api/gh/factsCenter/pcUpcomingEvents?...               upcoming fixtures        (verified)
//   GET /api/gh/orders/share/{code}                            a booking code           (errors verified)
//
// The share endpoint's *error* envelope is verified; its success envelope is not, because that
// needs a real unexpired code. parseSharedSelections() is written defensively for that reason and
// logs the shape it actually received when it cannot read one, so the first real code tells us
// exactly what to change rather than failing silently. See SHARE_SHAPE_UNVERIFIED below.

const BASE_URL = "https://www.sportybet.com/api/gh/";
const FOOTBALL = "sr:sport:1";
const PRODUCT_PREMATCH = 3;

// SportyBet serves the JSON API only to requests that look like its own web client.
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  referer: "https://www.sportybet.com/gh/sport/football",
};

/** SportyBet's own status codes, from `bizCode`. */
const BIZ_OK = 10000;
const BIZ_INVALID = 19000;

type SportyOutcome = {
  id: string;
  odds: string;
  probability?: string;
  isActive?: number;
  desc?: string;
};

type SportyMarket = {
  id: string;
  specifier?: string;
  name?: string;
  desc?: string;
  status?: number;
  product?: number;
  outcomes?: SportyOutcome[];
};

type SportyEvent = {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
  estimateStartTime: number;
  status?: number;
  matchStatus?: string;
  markets?: SportyMarket[];
  sport?: { category?: { name?: string; tournament?: { name?: string } } };
};

type Envelope<T> = { bizCode: number; message?: string; innerMsg?: string; data?: T };

type UpcomingData = { totalNum?: number; tournaments?: { events?: SportyEvent[] }[] };

function unwrap<T>(res: Envelope<T>, context: string): T {
  if (res.bizCode === BIZ_OK && res.data !== undefined) return res.data;
  logger.warn("sportybet.biz_error", { context, bizCode: res.bizCode, message: res.innerMsg ?? res.message });
  throw new AppError("BOOKMAKER_UNAVAILABLE", "SportyBet couldn't give us that right now. Please try again in a moment.");
}

function statusOf(e: SportyEvent): EventStatus {
  const label = (e.matchStatus ?? "").toLowerCase();
  if (label.includes("not start") || label === "") return e.status === 0 ? "NOT_STARTED" : "LIVE";
  if (label.includes("end") || label.includes("ft") || label.includes("finish") || label.includes("closed")) return "ENDED";
  return "LIVE";
}

function toEventInfo(e: SportyEvent): BookmakerEventInfo {
  return {
    externalId: e.eventId,
    home: e.homeTeamName,
    away: e.awayTeamName,
    kickoffAt: new Date(e.estimateStartTime),
    competition: e.sport?.category?.tournament?.name ?? null,
    country: e.sport?.category?.name ?? null,
    status: statusOf(e),
  };
}

function toRawMarket(m: SportyMarket, o: SportyOutcome): RawMarket {
  return {
    marketId: m.id,
    outcomeId: o.id,
    specifier: m.specifier ?? "",
    marketName: m.name ?? m.desc ?? betradarMarketName(m.id) ?? m.id,
    outcomeName: o.desc,
  };
}

/**
 * The bookmaker's own margin-free probability for an outcome, when it publishes one.
 * SportyBet sends `probability` on every outcome and they sum to 1 across a market, so this is
 * the operator's true price rather than anything we have modelled. Never synthesise it.
 */
export function probabilityOf(o: SportyOutcome): number | null {
  const p = Number(o.probability);
  return Number.isFinite(p) && p > 0 && p <= 1 ? p : null;
}

const isLiveOffer = (m: SportyMarket, o: SportyOutcome) =>
  (m.status ?? 0) === 0 && (o.isActive ?? 1) === 1 && Number(o.odds) > 1;

// --- Event markets -----------------------------------------------------------

/** Every market and current price for one event. Short TTL: these are live odds. */
export async function fetchEvent(eventId: string): Promise<SportyEvent> {
  const res = await cachedGet<Envelope<SportyEvent>>({
    scope: "sportybet",
    baseUrl: BASE_URL,
    endpoint: "factsCenter/event",
    params: { eventId, productId: PRODUCT_PREMATCH },
    ttlSeconds: 30,
    headers: HEADERS,
    timeoutMs: 12_000,
    cacheable: (p) => (p as Envelope<SportyEvent>).bizCode === BIZ_OK,
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

/** Like getEventMarkets, but keeps the probability SportyBet publishes for each outcome. */
export async function getEventOffersWithProbability(eventId: string) {
  const event = await fetchEvent(eventId);
  const offers = [];
  for (const m of event.markets ?? []) {
    for (const o of m.outcomes ?? []) {
      if (!isLiveOffer(m, o)) continue;
      const raw = toRawMarket(m, o);
      offers.push({ raw, market: mapBetradarMarket(raw), odds: Number(o.odds), probability: probabilityOf(o) });
    }
  }
  return { event: toEventInfo(event), offers };
}

// --- Upcoming fixtures -------------------------------------------------------

/**
 * Football fixtures kicking off within `hours`. One page is plenty for matching a handful of
 * games; the AI slip builder asks for more. Cached for a few minutes: fixture lists barely move.
 */
export async function listUpcoming({ hours = 24, pages = 1 } = {}): Promise<BookmakerEventInfo[]> {
  const events: BookmakerEventInfo[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await cachedGet<Envelope<UpcomingData>>({
      scope: "sportybet",
      baseUrl: BASE_URL,
      endpoint: "factsCenter/pcUpcomingEvents",
      params: { sportId: FOOTBALL, marketId: 1, pageSize: 100, pageNum: page, option: 1, timeline: hours },
      ttlSeconds: 180,
      headers: HEADERS,
      timeoutMs: 15_000,
      cacheable: (p) => (p as Envelope<UpcomingData>).bizCode === BIZ_OK,
    });
    const data = unwrap(res, "upcoming");
    const batch = (data.tournaments ?? []).flatMap((t) => t.events ?? []);
    if (!batch.length) break;
    events.push(...batch.map(toEventInfo));
  }
  return events;
}

/**
 * Market groups we ask for inline when building a slip. pcUpcomingEvents accepts any market ids and
 * embeds them in the fixture list, which matters enormously: this returns ~20 KB per fixture across
 * all of these groups, where fetching one fixture's *full* market list is about 1.3 MB. Keep this
 * list deliberate — every id added is paid for on every page.
 */
export const INLINE_MARKET_IDS = [
  "1", // 1X2
  "10", // Double Chance
  "18", // Over/Under
  "29", // GG/NG (both teams to score)
  "19", // Home total
  "20", // Away total
  "68", // 1st half Over/Under
  "75", // 1st half GG/NG
  "166", // Corners Over/Under
  "139", // Bookings (cards) Over/Under
  "900342", // Fouls Over/Under
] as const;

export type FixtureOffer = {
  raw: RawMarket;
  market: ReturnType<typeof mapBetradarMarket>;
  odds: number;
  /** SportyBet's own margin-free probability. Null only if they omitted it. */
  probability: number | null;
};

export type FixtureWithOffers = { event: BookmakerEventInfo; offers: FixtureOffer[] };

/**
 * Upcoming fixtures with a chosen set of markets priced inline — one request per page, no per-event
 * calls. This is what the slip builder and the daily picks run on.
 */
export async function listUpcomingWithOffers({
  hours = 24,
  pages = 2,
  marketIds = INLINE_MARKET_IDS as readonly string[],
} = {}): Promise<FixtureWithOffers[]> {
  const out: FixtureWithOffers[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await cachedGet<Envelope<UpcomingData>>({
      scope: "sportybet",
      baseUrl: BASE_URL,
      endpoint: "factsCenter/pcUpcomingEvents",
      params: {
        sportId: FOOTBALL,
        marketId: marketIds.join(","),
        pageSize: 20,
        pageNum: page,
        option: 1,
        timeline: hours,
      },
      ttlSeconds: 120,
      headers: HEADERS,
      timeoutMs: 20_000,
      cacheable: (p) => (p as Envelope<UpcomingData>).bizCode === BIZ_OK,
    });
    const batch = (unwrap(res, "upcomingWithOffers").tournaments ?? []).flatMap((t) => t.events ?? []);
    if (!batch.length) break;
    for (const e of batch) {
      const offers: FixtureOffer[] = [];
      for (const m of e.markets ?? []) {
        for (const o of m.outcomes ?? []) {
          if (!isLiveOffer(m, o)) continue;
          const raw = toRawMarket(m, o);
          offers.push({ raw, market: mapBetradarMarket(raw), odds: Number(o.odds), probability: probabilityOf(o) });
        }
      }
      if (offers.length) out.push({ event: toEventInfo(e), offers });
    }
  }
  return out;
}

export async function searchEvent(home: string, away: string, kickoff: Date): Promise<BookmakerEventInfo[]> {
  // No public search endpoint exists, so match against the upcoming list. Widen the window enough
  // to cover the fixture even when it is a day or two out.
  const hoursAhead = Math.ceil((kickoff.getTime() - Date.now()) / 3_600_000) + 6;
  const candidates = await listUpcoming({ hours: Math.min(Math.max(hoursAhead, 24), 168), pages: 3 });
  const hit = bestMatch({ home, away, kickoffAt: kickoff }, candidates);
  return hit ? [hit.candidate] : [];
}

// --- Booking codes -----------------------------------------------------------

/**
 * SHARE_SHAPE_UNVERIFIED.
 * We know `GET orders/share/{code}` answers `{bizCode:19000, innerMsg:"The code is invalid."}`
 * for a bad code and `bizCode:10000` with a body for a good one, but not what that body looks
 * like. Rather than guess a full slip shape, we extract only what every plausible shape must
 * carry — the event id and the market/outcome/specifier of each pick — and then price each pick
 * from factsCenter/event, which is verified. If we cannot find any picks we log the keys we were
 * given and surface a service error, never "your code is invalid".
 */
export function parseSharedSelections(data: unknown): { eventId: string; raw: RawMarket }[] {
  const out: { eventId: string; raw: RawMarket }[] = [];
  const seen = new Set<unknown>();

  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const o = node as Record<string, unknown>;
    const eventId = str(o.eventId) ?? str(o.matchId);
    const marketId = str(o.marketId) ?? str(o.marketTypeId);
    const outcomeId = str(o.outcomeId) ?? str(o.oddsId) ?? str(o.outcomeNo);
    if (eventId && marketId && outcomeId) {
      out.push({
        eventId,
        raw: {
          marketId,
          outcomeId,
          specifier: str(o.specifier) ?? "",
          marketName: str(o.marketName) ?? str(o.marketDesc) ?? betradarMarketName(marketId),
          outcomeName: str(o.outcomeName) ?? str(o.outcomeDesc) ?? str(o.desc),
        },
      });
    }
    for (const v of Object.values(o)) visit(v);
  };

  visit(data);
  // The same pick can appear in more than one nesting; keep one of each.
  const key = (s: { eventId: string; raw: RawMarket }) => `${s.eventId}|${s.raw.marketId}|${s.raw.outcomeId}|${s.raw.specifier}`;
  return [...new Map(out.map((s) => [key(s), s])).values()];
}

/** Keys of an object graph, a few levels deep, for diagnosing an unknown response shape. */
function shapeOf(value: unknown, depth = 3): unknown {
  if (Array.isArray(value)) return depth <= 0 ? `[${value.length}]` : [shapeOf(value[0], depth - 1)];
  if (value && typeof value === "object") {
    if (depth <= 0) return Object.keys(value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth - 1)]));
  }
  return typeof value;
}

export async function loadCode(code: string): Promise<LoadedSlip> {
  const res = await cachedGet<Envelope<unknown> & { isAvailable?: boolean }>({
    scope: "sportybet",
    baseUrl: BASE_URL,
    endpoint: `orders/share/${encodeURIComponent(code)}`,
    ttlSeconds: 20,
    headers: HEADERS,
    timeoutMs: 12_000,
    cacheable: (p) => (p as Envelope<unknown>).bizCode === BIZ_OK,
  });

  if (res.bizCode === BIZ_INVALID) {
    const msg = (res.innerMsg ?? res.message ?? "").toLowerCase();
    if (msg.includes("expire")) throw new AppError("EXPIRED_CODE", `Booking code ${code} has expired on SportyBet.`);
    throw new AppError("INVALID_CODE", `SportyBet doesn't recognise booking code ${code}.`);
  }
  if (res.bizCode !== BIZ_OK) {
    logger.warn("sportybet.share_biz_error", { code, bizCode: res.bizCode, message: res.innerMsg ?? res.message });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "SportyBet couldn't open that code right now. Please try again in a moment.");
  }

  const picks = parseSharedSelections(res.data);
  if (!picks.length) {
    // Our reader, not the user's code. Log the shape so this is a one-line fix.
    logger.error("sportybet.share_shape_unrecognised", { code, shape: JSON.stringify(shapeOf(res.data)).slice(0, 2000) });
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      "We reached SportyBet but couldn't read that slip. We're on it — your code is fine.",
    );
  }

  // Price every pick from the verified event endpoint, one request per distinct event.
  const byEvent = new Map<string, { raw: RawMarket }[]>();
  for (const p of picks) {
    const list = byEvent.get(p.eventId) ?? [];
    list.push({ raw: p.raw });
    byEvent.set(p.eventId, list);
  }

  const selections: LoadedSelection[] = [];
  for (const [eventId, list] of byEvent) {
    let event: BookmakerEventInfo | null = null;
    let offers: EventMarkets["offers"] = [];
    try {
      const markets = await getEventMarkets(eventId);
      event = markets.event;
      offers = markets.offers;
    } catch (error) {
      logger.warn("sportybet.share_event_unavailable", { code, eventId, error: String(error) });
    }
    for (const { raw } of list) {
      const offer = offers.find(
        (o) => o.raw.marketId === raw.marketId && o.raw.outcomeId === raw.outcomeId && o.raw.specifier === raw.specifier,
      );
      // A pick whose event we couldn't load is still shown, without a price, rather than dropped.
      if (!event) continue;
      selections.push({
        event,
        raw: offer?.raw ?? raw,
        market: mapBetradarMarket(offer?.raw ?? raw),
        odds: offer ? offer.odds : null,
      });
    }
  }

  if (!selections.length) {
    logger.error("sportybet.share_events_unavailable", { code, events: byEvent.size });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "SportyBet gave us the slip but not the games. Please try again in a moment.");
  }

  return { bookmaker: "sportybet", code, selections, expiresAt: null };
}
