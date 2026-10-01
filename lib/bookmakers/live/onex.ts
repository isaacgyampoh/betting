import "server-only";
import { cachedGet } from "@/lib/bookmakers/live/cached-get";
import { onexFormat } from "@/lib/bookmakers/formats/onex-format";
import type {
  BookmakerEventInfo,
  BookmakerSlug,
  CreateCodeSelection,
  CreatedCode,
  EventMarkets,
  LoadedSelection,
  LoadedSlip,
  RawMarket,
} from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bestMatch } from "@/lib/matching/similarity";

// The platform behind 1xBet, PariPesa, 22Bet and Betwinner. Found by probing the public sites with
// no account; recorded in docs/capturing-bookmaker-requests.md with the date each was verified.
//
//   GET  {base}/service-api/LineFeed/Get1x2_VZip?sports=1&count=N&lng=en&mode=4   fixtures + odds
//   GET  {base}/service-api/LineFeed/GetGameZip?id={constId}&lng=en&cfView=0...   one event
//   POST {base}/service-api/LiveBet/Open/SaveCoupon                               create a code
//   POST {base}/service-api/LiveBet/Open/GetCoupon                                read a code
//
// Two things to know before touching this:
//
//  * Fixtures and odds are verified. **Booking is not**: the two coupon endpoints answer, and the
//    event shape below comes from the platform's own serializer, but no code has been created and
//    read back. Until that happens the adapters declare loadCode and createCode as unsupported, so
//    nothing here reaches a user.
//  * These bookmakers publish no per-outcome probability (SportyBet does), so offers carry
//    `probability: null` and the AI slip builder will skip them. They are for loading and
//    converting codes, not for building slips.

export type OnexConfig = {
  slug: BookmakerSlug;
  name: string;
  /** Site root, no trailing slash, e.g. https://1xbet.com.gh */
  baseUrl: string;
};

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

/** A priced outcome: market group, outcome type, coefficient and an optional line. */
type Bet = { T: number; C: number; G: number; P?: number };

type Game = {
  /** Feed id, which changes; this is what a bet refers to. */
  I: number;
  /** Constant id, stable and used in page URLs; this is what GetGameZip takes. */
  CI?: number;
  O1?: string;
  O2?: string;
  /** Kickoff, epoch *seconds*. */
  S?: number;
  L?: string;
  CN?: string;
  E?: Bet[];
};

type Envelope<T> = { Success?: boolean; Error?: string; ErrorCode?: number; Value?: T };

/** Our RawMarket for one of their bets. Line goes in the specifier so nothing is lost. */
export function toRawMarket(b: Bet): RawMarket {
  const raw: RawMarket = {
    marketId: `G${b.G}`,
    outcomeId: `T${b.T}`,
    specifier: b.P === undefined ? "" : `P=${b.P}`,
  };
  const market = onexFormat.mapMarket(raw);
  // Only markets we have verified get a name; the rest stay anonymous rather than mislabelled.
  return market ? { ...raw, marketName: onexFormat.unmapMarket(market)?.marketName } : raw;
}

function toEventInfo(g: Game): BookmakerEventInfo {
  return {
    externalId: String(g.CI ?? g.I),
    home: g.O1 ?? "",
    away: g.O2 ?? "",
    kickoffAt: new Date((g.S ?? 0) * 1000),
    competition: g.L ?? null,
    country: g.CN ?? null,
    status: (g.S ?? 0) * 1000 > Date.now() ? "NOT_STARTED" : "LIVE",
  };
}

const offersOf = (g: Game) =>
  (g.E ?? [])
    .filter((b) => b.C > 1)
    .map((b) => {
      const raw = toRawMarket(b);
      return { raw, market: onexFormat.mapMarket(raw), odds: b.C, probability: null as number | null };
    });

export function createOnexClient(config: OnexConfig) {
  const api = `${config.baseUrl}/service-api/`;
  const headers = { ...HEADERS, referer: `${config.baseUrl}/en` };

  function unwrap<T>(res: Envelope<T>, context: string): T {
    if (res.Success && res.Value !== undefined) return res.Value;
    logger.warn(`${config.slug}.feed_error`, { context, error: res.Error, errorCode: res.ErrorCode });
    throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} couldn't give us that right now. Please try again in a moment.`);
  }

  /** One event with every market. Takes the constant id, which is what the site's own URLs use. */
  async function fetchGame(eventId: string): Promise<Game> {
    const res = await cachedGet<Envelope<Game>>({
      scope: config.slug,
      baseUrl: api,
      endpoint: "LineFeed/GetGameZip",
      params: { id: eventId, lng: "en", cfView: 0, isSubGames: "true", GroupEvents: "true" },
      ttlSeconds: 30,
      headers,
      timeoutMs: 15_000,
      cacheable: (p) => (p as Envelope<Game>).Success === true,
    });
    return unwrap(res, "game");
  }

  async function getEventMarkets(eventId: string): Promise<EventMarkets> {
    const game = await fetchGame(eventId);
    return { event: toEventInfo(game), offers: offersOf(game).map(({ raw, market, odds }) => ({ raw, market, odds })) };
  }

  /** Upcoming football with the main markets priced inline — one request, no per-event calls. */
  async function listUpcomingWithOffers({ count = 100 } = {}) {
    const res = await cachedGet<Envelope<Game[]>>({
      scope: config.slug,
      baseUrl: api,
      endpoint: "LineFeed/Get1x2_VZip",
      // Extra params such as `country` or `partner` make this answer 406; keep it to these.
      params: { sports: 1, count, lng: "en", mode: 4 },
      ttlSeconds: 180,
      headers,
      timeoutMs: 20_000,
      cacheable: (p) => (p as Envelope<Game[]>).Success === true,
    });
    return unwrap(res, "upcoming").map((g) => ({ event: toEventInfo(g), offers: offersOf(g) }));
  }

  async function listUpcoming(opts: { count?: number } = {}): Promise<BookmakerEventInfo[]> {
    return (await listUpcomingWithOffers(opts)).map((f) => f.event);
  }

  async function searchEvent(home: string, away: string, kickoff: Date): Promise<BookmakerEventInfo[]> {
    const hit = bestMatch({ home, away, kickoffAt: kickoff }, await listUpcoming({ count: 300 }));
    return hit ? [hit.candidate] : [];
  }

  // --- Booking codes: implemented, NOT verified. See the note at the top of this file. ---

  async function post<T>(endpoint: string, body: unknown): Promise<Envelope<T>> {
    let res: Response;
    try {
      res = await fetch(`${api}${endpoint}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", accept: "application/json", origin: config.baseUrl },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      logger.error(`${config.slug}.post_failed`, { endpoint, error: String(error) });
      throw new AppError("BOOKMAKER_UNAVAILABLE", `We couldn't reach ${config.name}. Please try again in a moment.`);
    }
    if (!res.ok) {
      logger.error(`${config.slug}.post_http_error`, { endpoint, status: res.status });
      throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} isn't responding right now. Please try again in a moment.`);
    }
    return (await res.json()) as Envelope<T>;
  }

  /** `guid` is the booking code, despite the name: a wrong one answers "Incorrect code". */
  async function loadCode(code: string): Promise<LoadedSlip> {
    const body = await post<{ Events?: Bet[] }>("LiveBet/Open/GetCoupon", { guid: code, CfView: 0, Lng: "en" });
    if (!body.Success) {
      const message = (body.Error ?? "").toLowerCase();
      if (message.includes("incorrect")) throw new AppError("INVALID_CODE", `${config.name} doesn't recognise booking code ${code}.`);
      if (message.includes("finish") || message.includes("expire")) {
        throw new AppError("EXPIRED_CODE", `Booking code ${code} has no games left on ${config.name}.`);
      }
      logger.warn(`${config.slug}.load_failed`, { code, error: body.Error, errorCode: body.ErrorCode });
      throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} couldn't open that code right now.`);
    }

    const bets = body.Value?.Events ?? [];
    if (!bets.length) throw new AppError("EXPIRED_CODE", `Booking code ${code} has no games left on ${config.name}.`);

    // Each bet names its game, so the events are fetched once each and priced from the feed.
    const selections: LoadedSelection[] = [];
    for (const bet of bets) {
      const gameId = (bet as Bet & { GameId?: number }).GameId;
      if (!gameId) continue;
      const game = await fetchGame(String(gameId)).catch(() => null);
      if (!game) continue;
      const raw = toRawMarket(bet);
      selections.push({ event: toEventInfo(game), raw, market: onexFormat.mapMarket(raw), odds: bet.C > 1 ? bet.C : null });
    }
    if (!selections.length) {
      logger.error(`${config.slug}.load_unreadable`, { code, bets: bets.length });
      throw new AppError("BOOKMAKER_UNAVAILABLE", `We reached ${config.name} but couldn't read that slip. Your code is fine.`);
    }
    return { bookmaker: config.slug, code, selections, expiresAt: null };
  }

  async function createCode(selections: CreateCodeSelection[]): Promise<CreatedCode> {
    if (!selections.length) throw new AppError("BAD_REQUEST", "There are no picks to book.");

    const events = selections.map(({ eventExternalId, market, raw: given }) => {
      const raw = given ?? (market ? onexFormat.unmapMarket(market) : null);
      if (!raw) {
        const what = market ? `${market.type} (${market.period})` : "that market";
        throw new AppError("BAD_REQUEST", `${config.name} doesn't offer ${what}, so this slip can't be booked there.`);
      }
      const line = raw.specifier.match(/^P=([+-]?\d+(?:\.\d+)?)$/);
      // Shape taken from the platform's own serializer; Kind 3 is a prematch bet, 1 is live.
      return {
        GameId: Number(eventExternalId),
        Type: Number(raw.outcomeId.replace(/^T/, "")),
        Coef: 0,
        Param: line ? Number(line[1]) : 0,
        PV: null,
        PlayerId: 0,
        Kind: 3,
        InstrumentId: 0,
        Seconds: 0,
        Price: 0,
        Expired: 0,
      };
    });

    const body = await post<string>("LiveBet/Open/SaveCoupon", { Events: events, Lng: "en" });
    if (!body.Success || !body.Value) {
      logger.warn(`${config.slug}.create_rejected`, { error: body.Error, errorCode: body.ErrorCode, picks: events.length });
      throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} wouldn't book this slip. A game may have started.`);
    }
    // SaveCoupon returns a code even when it accepted nothing, so the booking is read back before
    // anyone is handed it.
    const check = await loadCode(body.Value).catch(() => null);
    if (!check || check.selections.length < events.length) {
      logger.warn(`${config.slug}.create_incomplete`, { code: body.Value, got: check?.selections.length ?? 0, sent: events.length });
      throw new AppError("BOOKMAKER_UNAVAILABLE", `${config.name} didn't accept all of these picks, so there's no code to give you.`);
    }
    return { code: body.Value, expiresAt: null };
  }

  return { fetchGame, getEventMarkets, listUpcoming, listUpcomingWithOffers, searchEvent, loadCode, createCode };
}
