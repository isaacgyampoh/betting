import "server-only";
import { cachedGet } from "@/lib/bookmakers/live/cached-get";
import { betradarMarketName, mapBetradarMarket, unmapBetradarMarket } from "@/lib/bookmakers/formats/betradar-format";
import type {
  BookmakerEventInfo,
  BookmakerSlug,
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

// The "hopegaming" sportsbook platform, shared by several Ghanaian bookmakers. SportyBet and
// Football.com run it with identical paths; MSport runs a variant with different ones and has its
// own client. Everything here was found by probing the public sites with no account, and is
// recorded in docs/capturing-bookmaker-requests.md with the date it was verified:
//
//   GET  {base}/factsCenter/event?eventId={id}&productId=3   one event, every market
//   GET  {base}/factsCenter/pcUpcomingEvents?...             upcoming fixtures, markets inline
//   GET  {base}/orders/share/{code}                          read a booking code
//   POST {base}/orders/share                                 create a booking code
//
// Market and outcome ids are the Betradar set (lib/bookmakers/formats/betradar-format.ts), so mock
// and live speak the same dialect and a pick carries between these bookmakers by id.

export type HopegamingConfig = {
  slug: BookmakerSlug;
  name: string;
  /** Must end in a slash: every endpoint below is resolved against it. */
  baseUrl: string;
  /** These sites serve the JSON API only to requests that look like their own web client. */
  headers: Record<string, string>;
};

const FOOTBALL = "sr:sport:1";
const PRODUCT_PREMATCH = 3;

/** Platform status codes, from `bizCode`. */
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


/**
 * The groups we hold recent-results history for. Asking for only these is noticeably faster than
 * the full set — about 4.8s against 7.4s cold for three pages — and yields exactly the same
 * evidence-capable candidates, so it is what a build asks for first.
 */
export const CORE_MARKET_IDS = ["1", "10", "18", "29"] as const;

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
  const key = (s: { eventId: string; raw: RawMarket }) => `${s.eventId}|${s.raw.marketId}|${s.raw.outcomeId}|${s.raw.specifier}`;
  return [...new Map(out.map((s) => [key(s), s])).values()];
}

/** Keys of an object graph, a few levels deep, for diagnosing an unexpected response shape. */
function shapeOf(value: unknown, depth = 3): unknown {
  if (Array.isArray(value)) return depth <= 0 ? `[${value.length}]` : [shapeOf(value[0], depth - 1)];
  if (value && typeof value === "object") {
    if (depth <= 0) return Object.keys(value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth - 1)]));
  }
  return typeof value;
}

/** Builds a live client for one bookmaker on this platform. */
export function createHopegamingClient(config: HopegamingConfig) {
function unwrap<T>(res: Envelope<T>, context: string): T {
  if (res.bizCode === BIZ_OK && res.data !== undefined) return res.data;
  logger.warn(`${config.slug}.biz_error`, { context, bizCode: res.bizCode, message: res.innerMsg ?? res.message });
  throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} couldn't give us that right now. Please try again in a moment.`);
}

// --- Event markets -----------------------------------------------------------

/** Every market and current price for one event. Short TTL: these are live odds. */
async function fetchEvent(eventId: string): Promise<SportyEvent> {
  const res = await cachedGet<Envelope<SportyEvent>>({
    scope: config.slug,
    baseUrl: config.baseUrl,
    endpoint: "factsCenter/event",
    params: { eventId, productId: PRODUCT_PREMATCH },
    ttlSeconds: 30,
    headers: config.headers,
    timeoutMs: 12_000,
    cacheable: (p) => (p as Envelope<SportyEvent>).bizCode === BIZ_OK,
  });
  return unwrap(res, "event");
}

async function getEventMarkets(eventId: string): Promise<EventMarkets> {
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

/** Like getEventMarkets, but keeps the probability ${config.name} publishes for each outcome. */
async function getEventOffersWithProbability(eventId: string) {
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
async function listUpcoming({ hours = 24, pages = 1 } = {}): Promise<BookmakerEventInfo[]> {
  const events: BookmakerEventInfo[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await cachedGet<Envelope<UpcomingData>>({
      scope: config.slug,
      baseUrl: config.baseUrl,
      endpoint: "factsCenter/pcUpcomingEvents",
      params: { sportId: FOOTBALL, marketId: 1, pageSize: 100, pageNum: page, option: 1, timeline: hours },
      ttlSeconds: 180,
      headers: config.headers,
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
async function listUpcomingWithOffers({
  hours = 24,
  pages = 2,
  marketIds = INLINE_MARKET_IDS as readonly string[],
} = {}): Promise<FixtureWithOffers[]> {
  // Pages are fetched together rather than one after another. Sequentially this was the slowest
  // thing in the product: three pages of fixtures, each carrying eleven market groups, took over
  // ten seconds before the assistant could start. A page that fails is skipped rather than losing
  // the rest.
  const requests = Array.from({ length: pages }, (_, i) =>
    cachedGet<Envelope<UpcomingData>>({
      scope: config.slug,
      baseUrl: config.baseUrl,
      endpoint: "factsCenter/pcUpcomingEvents",
      params: {
        sportId: FOOTBALL,
        marketId: marketIds.join(","),
        pageSize: 20,
        pageNum: i + 1,
        option: 1,
        timeline: hours,
      },
      ttlSeconds: 120,
      headers: config.headers,
      timeoutMs: 20_000,
      cacheable: (p) => (p as Envelope<UpcomingData>).bizCode === BIZ_OK,
    }).catch(() => null),
  );

  const out: FixtureWithOffers[] = [];
  for (const res of await Promise.all(requests)) {
    if (!res || res.bizCode !== BIZ_OK) continue;
    for (const e of (res.data?.tournaments ?? []).flatMap((t) => t.events ?? [])) {
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

async function searchEvent(home: string, away: string, kickoff: Date): Promise<BookmakerEventInfo[]> {
  // No public search endpoint exists, so match against the upcoming list. Widen the window enough
  // to cover the fixture even when it is a day or two out.
  const hoursAhead = Math.ceil((kickoff.getTime() - Date.now()) / 3_600_000) + 6;
  const candidates = await listUpcoming({ hours: Math.min(Math.max(hoursAhead, 24), 168), pages: 3 });
  const hit = bestMatch({ home, away, kickoffAt: kickoff }, candidates);
  return hit ? [hit.candidate] : [];
}

type ShareData = {
  shareCode?: string;
  shareURL?: string;
  /** Epoch ms after which the code stops working. */
  deadline?: number;
  ticket?: { selections?: unknown[] };
  /** Full event objects, one per picked market, with the chosen outcome priced. */
  outcomes?: SportyEvent[];
  /** Picks ${config.name} can no longer offer (suspended market, started game). */
  unavailableOutcomes?: SportyEvent[];
};

/**
 * Picks from `data.outcomes`: each entry is an event carrying only the chosen market and outcome.
 * `available` is false for entries from `unavailableOutcomes`, which are kept so the user is told a
 * pick has dropped off rather than silently losing it.
 */
function selectionsFromOutcomes(events: SportyEvent[] | undefined, available: boolean): LoadedSelection[] {
  const out: LoadedSelection[] = [];
  for (const e of events ?? []) {
    const event = toEventInfo(e);
    for (const m of e.markets ?? []) {
      for (const o of m.outcomes ?? []) {
        const raw = toRawMarket(m, o);
        const odds = Number(o.odds);
        out.push({
          event,
          raw,
          market: mapBetradarMarket(raw),
          // An unavailable pick has no price we can stand behind.
          odds: available && Number.isFinite(odds) && odds > 1 ? odds : null,
        });
      }
    }
  }
  return out;
}

/**
 * Fallback reader, kept for the day ${config.name} changes `data.outcomes`. It extracts only the event
 * id and market/outcome/specifier of each pick — the minimum any shape must carry — so a slip can
 * still be priced from the verified event endpoint. Exported for tests.
 */
/** Prices picks through the verified event endpoint. Only used if `data.outcomes` ever disappears. */
async function priceViaEvents(code: string, picks: { eventId: string; raw: RawMarket }[]): Promise<LoadedSelection[]> {
  const byEvent = new Map<string, RawMarket[]>();
  for (const p of picks) byEvent.set(p.eventId, [...(byEvent.get(p.eventId) ?? []), p.raw]);

  const selections: LoadedSelection[] = [];
  for (const [eventId, raws] of byEvent) {
    let event: BookmakerEventInfo | null = null;
    let offers: EventMarkets["offers"] = [];
    try {
      const markets = await getEventMarkets(eventId);
      event = markets.event;
      offers = markets.offers;
    } catch (error) {
      logger.warn(`${config.slug}.share_event_unavailable`, { code, eventId, error: String(error) });
      continue;
    }
    for (const raw of raws) {
      const offer = offers.find(
        (o) => o.raw.marketId === raw.marketId && o.raw.outcomeId === raw.outcomeId && o.raw.specifier === raw.specifier,
      );
      selections.push({ event, raw: offer?.raw ?? raw, market: mapBetradarMarket(offer?.raw ?? raw), odds: offer?.odds ?? null });
    }
  }
  return selections;
}

async function loadCode(code: string): Promise<LoadedSlip> {
  const res = await cachedGet<Envelope<ShareData> & { isAvailable?: boolean }>({
    scope: config.slug,
    baseUrl: config.baseUrl,
    endpoint: `orders/share/${encodeURIComponent(code)}`,
    ttlSeconds: 20,
    headers: config.headers,
    timeoutMs: 12_000,
    cacheable: (p) => (p as Envelope<ShareData>).bizCode === BIZ_OK,
  });

  if (res.bizCode === BIZ_INVALID) {
    const msg = (res.innerMsg ?? res.message ?? "").toLowerCase();
    if (msg.includes("expire")) throw new AppError("EXPIRED_CODE", `Booking code ${code} has expired on ${config.name}.`);
    throw new AppError("INVALID_CODE", `${config.name} doesn't recognise booking code ${code}.`);
  }
  if (res.bizCode !== BIZ_OK || !res.data) {
    logger.warn(`${config.slug}.share_biz_error`, { code, bizCode: res.bizCode, message: res.innerMsg ?? res.message });
    throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} couldn't open that code right now. Please try again in a moment.`);
  }

  const data = res.data;
  const expiresAt = typeof data.deadline === "number" ? new Date(data.deadline) : null;
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    throw new AppError("EXPIRED_CODE", `Booking code ${code} has expired on ${config.name}.`);
  }

  let selections = [
    ...selectionsFromOutcomes(data.outcomes, true),
    ...selectionsFromOutcomes(data.unavailableOutcomes, false),
  ];

  if (!selections.length) {
    // `data.outcomes` was empty or has changed shape. Fall back to the minimal reader and price
    // through the event endpoint, and log the shape so the gap is a one-line fix.
    const picks = parseSharedSelections(data);
    logger.warn(`${config.slug}.share_outcomes_missing`, {
      code,
      picks: picks.length,
      shape: JSON.stringify(shapeOf(data)).slice(0, 2000),
    });
    if (picks.length) selections = await priceViaEvents(code, picks);
  }

  if (!selections.length) {
    // Our reader, not the user's code.
    logger.error(`${config.slug}.share_shape_unrecognised`, { code, shape: JSON.stringify(shapeOf(data)).slice(0, 2000) });
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      `We reached ${config.name} but couldn't read that slip. We're on it — your code is fine.`,
    );
  }

  return { bookmaker: config.slug, code, selections, expiresAt };
}

/**
 * Books a slip at ${config.name} and returns its booking code. No account is involved: a booking code is
 * a shareable selection list, not a placed bet, and no money moves.
 */
async function createCode(selections: CreateCodeSelection[]): Promise<CreatedCode> {
  if (!selections.length) throw new AppError("BAD_REQUEST", "There are no picks to book.");

  const payload = selections.map(({ eventExternalId, market, raw: given }) => {
    const raw = given ?? (market ? unmapBetradarMarket(market) : null);
    if (!raw) {
      const what = market ? `${market.type} (${market.period})` : "that market";
      throw new AppError("BAD_REQUEST", `${config.name} doesn't offer ${what}, so this slip can't be booked there.`);
    }
    return {
      eventId: eventExternalId,
      marketId: raw.marketId,
      outcomeId: raw.outcomeId,
      // Only markets with a line carry a specifier; sending "" on the others is what their own
      // client does, but omitting it keeps the request minimal and is equally accepted.
      ...(raw.specifier ? { specifier: raw.specifier } : {}),
      sportId: FOOTBALL,
    };
  });

  const url = new URL("orders/share", config.baseUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...config.headers, "content-type": "application/json", accept: "application/json", origin: "https://www.sportybet.com" },
      body: JSON.stringify({ selections: payload }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    logger.error(`${config.slug}.create_failed`, { error: String(error) });
    throw new AppError("BOOKMAKER_UNAVAILABLE", `We couldn't reach ${config.name} to book that slip. Please try again in a moment.`);
  }

  if (!res.ok) {
    logger.error(`${config.slug}.create_http_error`, { status: res.status });
    throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} wouldn't book that slip just now. Please try again in a moment.`);
  }

  const body = (await res.json()) as Envelope<ShareData>;
  if (body.bizCode !== BIZ_OK || !body.data?.shareCode) {
    const message = body.innerMsg ?? body.message ?? "";
    logger.warn(`${config.slug}.create_rejected`, { bizCode: body.bizCode, message, picks: payload.length });
    // A rejection here is about the picks (a suspended market, a game that has started), not us.
    throw new AppError(
      "BOOKMAKER_UNAVAILABLE",
      message
        ? `${config.name} wouldn't book this slip: ${message}`
        : `${config.name} wouldn't book this slip. One of the games may have started or had its market suspended.`,
    );
  }

  const unavailable = body.data.unavailableOutcomes?.length ?? 0;
  if (unavailable) logger.warn(`${config.slug}.create_dropped_picks`, { code: body.data.shareCode, unavailable });

  return {
    code: body.data.shareCode,
    expiresAt: typeof body.data.deadline === "number" ? new Date(body.data.deadline) : null,
  };
}

  return {
    fetchEvent,
    getEventMarkets,
    getEventOffersWithProbability,
    listUpcoming,
    listUpcomingWithOffers,
    searchEvent,
    loadCode,
    createCode,
  };
}
