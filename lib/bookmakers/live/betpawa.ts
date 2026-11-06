import "server-only";
import { betpawaFormat } from "@/lib/bookmakers/formats/betpawa-format";
import type { BookmakerEventInfo, LoadedSelection, LoadedSlip, RawMarket } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * betPawa Ghana, reading booking codes.
 *
 *   GET {base}/api/sportsbook/v3/booking-number/{code}   read a booking code
 *
 * Headers `x-pawa-brand` and `x-pawa-language` are required; without the brand the API does not
 * know which site it is answering for.
 *
 * **The body is JSON.** docs/capturing-bookmaker-requests.md recorded this endpoint as returning
 * protobuf, which is why betPawa was never built: reading it would have meant guessing field
 * numbers, and a mis-read price is the one mistake that must not ship. Re-checked on 2026-11-06
 * against a real code and it answers `content-type: application/json` with every field named -
 * event, participants, kick-off, competition, region, market, selection and price. Whatever was
 * true before, it is readable now, so the reason for not building this is gone.
 *
 * Reading only. Creating a code is `POST .../booking-number` and is not implemented here: this
 * makes betPawa a place a slip can come *from*, which needs nothing from betPawa, and leaves
 * being a destination for when there is a reason to trust the write path.
 */
const BASE_URL = "https://www.betpawa.com.gh";

const HEADERS = {
  "x-pawa-brand": "betpawa-ghana",
  "x-pawa-language": "en",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

const TIMEOUT_MS = 12_000;

/**
 * A plain GET rather than `cachedGet`, because betPawa says "no such code" with a 404.
 *
 * The shared helper throws one generic "the bookmaker isn't responding" on any non-ok status and
 * discards the body, which is right for SportyBet - that one answers 200 and puts the verdict in
 * a `bizCode` - and wrong here, where the status *is* the verdict and the body names it. Through
 * the shared helper a mistyped code read as an outage, which sends somebody to check their
 * connection over a typo.
 *
 * Nothing is cached. A booking code is read once, by one person, and a stale slip is worse than a
 * second request.
 */
async function get<T>(path: string): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, BASE_URL), {
      headers: { accept: "application/json", ...HEADERS },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, body };
  } catch (error) {
    logger.error("betpawa.fetch_failed", { path, error: String(error) });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "We couldn't reach betPawa. Please try again in a moment.");
  } finally {
    clearTimeout(timer);
  }
}

type Participant = { id?: string; name?: string; position?: number };

type Item = {
  eventInfo?: {
    id?: string;
    participants?: Participant[];
    startTime?: string;
    competition?: { id?: string; name?: string };
    region?: { id?: string; name?: string };
    additionalInfo?: { live?: boolean };
  };
  selections?: {
    market?: {
      typeId?: string;
      name?: string;
      displayName?: string;
      formattedHandicap?: string;
      /** Where the line actually lives: `total` for a total, `hcp` for a handicap. */
      specifier?: { total?: string; hcp?: string } | null;
    };
    selectionInfo?: { id?: string; name?: string; displayName?: string; typeId?: string; handicap?: string };
  }[];
  odds?: { price?: number };
};

type Booking = { items?: Item[]; originalCount?: number };
type ApiError = { error?: string };

/** Position 1 is the home side and 2 the away side, which is how the payload orders a fixture. */
function teams(participants: Participant[]): { home: string; away: string } | null {
  const home = participants.find((p) => p.position === 1)?.name;
  const away = participants.find((p) => p.position === 2)?.name;
  return home && away ? { home, away } : null;
}

function toEventInfo(info: NonNullable<Item["eventInfo"]>, sides: { home: string; away: string }): BookmakerEventInfo {
  return {
    externalId: String(info.id ?? ""),
    home: sides.home,
    away: sides.away,
    kickoffAt: new Date(info.startTime ?? 0),
    competition: info.competition?.name ?? null,
    country: info.region?.name ?? null,
    status: info.additionalInfo?.live ? "LIVE" : "NOT_STARTED",
  };
}

/**
 * The pick as betPawa identifies it, kept verbatim.
 *
 * `marketId` is the market's own name rather than its numeric typeId, because the name is what the
 * mapping table reads and what a human can check against the site. The typeId travels too, in the
 * outcome id, so a selection can still be found again if the names are ever renamed.
 */
function toRawMarket(selection: NonNullable<Item["selections"]>[number]): RawMarket {
  // `formattedHandicap` is the obvious-looking field and it is empty even on markets that have a
  // line: a 2.5 total and a -4 handicap both carried "" there while `specifier` held the number.
  // Reading it alone meant every total and handicap arrived without a line and could not convert.
  //
  // `selectionInfo.handicap` holds it too but sometimes decorated - "Home -4" against the plain
  // "-4" in `specifier` - so `specifier` is the one to trust.
  const spec = selection.market?.specifier;
  const line = spec?.total ?? spec?.hcp ?? selection.market?.formattedHandicap ?? "";

  return {
    marketId: selection.market?.name ?? "",
    outcomeId: selection.selectionInfo?.name ?? "",
    specifier: line,
    marketName: selection.market?.displayName ?? selection.market?.name ?? undefined,
    outcomeName: selection.selectionInfo?.displayName ?? selection.selectionInfo?.name ?? undefined,
  };
}

export async function loadCode(code: string): Promise<LoadedSlip> {
  const { status, body } = await get<Booking & ApiError>(
    `/api/sportsbook/v3/booking-number/${encodeURIComponent(code)}`,
  );

  if (body?.error === "BOOKING_CODE_NOT_FOUND" || status === 404) {
    throw new AppError("INVALID_CODE", `betPawa doesn't recognise booking code ${code}.`);
  }
  if (status !== 200) {
    logger.error("betpawa.http_error", { code, status, error: body?.error });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "betPawa isn't responding right now. Please try again in a moment.");
  }

  const items = body?.items ?? [];
  if (!items.length) throw new AppError("EXPIRED_CODE", `Booking code ${code} has no games left on betPawa.`);

  const selections: LoadedSelection[] = [];
  for (const item of items) {
    const info = item.eventInfo;
    const sides = info?.participants ? teams(info.participants) : null;
    const pick = item.selections?.[0];
    if (!info || !sides || !pick) continue;

    const event = toEventInfo(info, sides);
    const raw = toRawMarket(pick);
    const price = item.odds?.price;

    selections.push({
      event,
      raw,
      market: betpawaFormat.mapMarket(raw),
      odds: typeof price === "number" && price > 1 ? price : null,
    });
  }

  if (!selections.length) {
    logger.error("betpawa.load_unreadable", { code, items: items.length });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "We reached betPawa but couldn't read that slip. Your code is fine.");
  }

  // betPawa drops legs whose game has started; `originalCount` is what the code was booked with.
  if (body?.originalCount && body.originalCount > selections.length) {
    logger.info("betpawa.partial_code", { code, booked: body.originalCount, left: selections.length });
  }

  return { bookmaker: "betpawa", code, selections, expiresAt: null };
}

/**
 * The rest of the adapter surface, which betPawa does not serve here.
 *
 * `LiveOps` is all four operations, so they have to exist. They refuse rather than pretend: the
 * capabilities above already say `createCode: false` and `events: false`, so nothing routes here
 * in normal use, and a caller that gets through anyway is told plainly instead of receiving an
 * empty list it might read as "betPawa has no markets for this game".
 */
const notBuilt = (what: string) => async (): Promise<never> => {
  throw new AppError("BOOKMAKER_NOT_CONNECTED", `We can read betPawa booking codes but not ${what} yet.`);
};

export const createCode = notBuilt("create them");
export const searchEvent = notBuilt("search its fixtures");
export const getEventMarkets = notBuilt("read its markets");
