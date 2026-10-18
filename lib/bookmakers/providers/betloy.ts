import "server-only";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  ConversionRoute,
  RouteEndpoint,
  RouteResult,
  RouteSelection,
  RouteUnmatched,
} from "./types";

/**
 * The Betloy conversion API, as a route.
 *
 * Written against the contract published at betloy.com/api (read 2026-10-18) and **never run
 * against the service**: no account exists, because creating one is the owner's decision.
 *
 * Documented contract:
 *   GET  {base}/bookmakers            free   -> supported bookmakers with key, region, markets
 *   GET  {base}/usage                 free   -> this month's usage and remaining allowance
 *   POST {base}/convert               1 credit
 *        { booking_code, from_bookie_id, to_bookie_id }
 *        -> { success, message, data: { converted_code, total_odds, number_of_events, ... } }
 *   Appending `?test=true` returns mock data and uses no credits.
 *   Errors: 400 bad params or unsupported bookmaker, 401, 402 credits exhausted,
 *           429 rate limited (Retry-After), 500.
 *
 * Two things make this materially safer to evaluate than Convat:
 *
 *  1. **Bookmakers are numeric ids resolved from a free endpoint that carries a region.** Convat
 *     takes brand names with no country field at all, so a Ghana slip could become a Nigeria code
 *     with nobody able to tell. Here the region is part of the lookup, so the ambiguity can be
 *     refused before a credit is spent - see [resolveEndpoint].
 *  2. **`/usage` is free**, so the allowance can be read from the API itself rather than from the
 *     published plans, which contradict each other: the pricing page lists "No API access" for the
 *     free plan while the API page's own rate-limit table gives Free 10 requests/minute and 1,000
 *     monthly requests. Only the account can settle that, and it settles it for free.
 */

const DEFAULT_BASE = "https://betloy.com/api/v1";
const TIMEOUT_MS = 60_000;

/** One bookmaker as /bookmakers describes it. Field names are the documented ones. */
export type BetloyBookmaker = {
  id: number;
  key?: string;
  name?: string;
  region?: string | null;
};

type BetloyConvertData = {
  conversion_id?: string | number;
  original_code?: string;
  converted_code?: string | null;
  from_bookie?: string;
  to_bookie?: string;
  total_odds?: number | null;
  number_of_events?: number | null;
  status?: string;
  legs?: unknown[];
  flagged?: unknown[];
};

type BetloyResponse = { success?: boolean; message?: string; data?: BetloyConvertData | null };

/** Thrown when the account has no allowance left. Never retried: a retry cannot create credits. */
export class BetloyCreditsExhausted extends AppError {
  constructor() {
    super("PLAN_LIMIT_REACHED", "The conversion provider's credit allowance is used up.");
  }
}

export type BetloyConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Appends ?test=true. Mock data, no credits, per the published contract. */
  testMode?: boolean;
};

/**
 * Picks the one bookmaker row that is this brand in this country.
 *
 * Exported because the evaluation harness validates every route with it *before* spending a
 * credit, and because the rule it encodes is the one worth testing on its own: a brand that
 * appears in several regions and cannot be narrowed to one is refused, never guessed at. Choosing
 * silently is how a Ghana slip becomes a Nigeria code that looks perfectly correct.
 */
export function resolveEndpoint(
  list: readonly BetloyBookmaker[],
  endpoint: RouteEndpoint,
): { id: number } | { error: string } {
  const brand = endpoint.brand.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const country = endpoint.country.toUpperCase();

  const sameBrand = list.filter((b) => {
    const name = `${b.name ?? ""} ${b.key ?? ""}`.toLowerCase().replace(/[^a-z0-9.]/g, "");
    return name.includes(brand);
  });
  if (sameBrand.length === 0) return { error: `Betloy does not list ${endpoint.brand}.` };

  const inCountry = sameBrand.filter((b) => (b.region ?? "").toUpperCase().includes(country));
  if (inCountry.length === 1) return { id: inCountry[0].id };
  if (inCountry.length > 1) {
    return { error: `Betloy lists ${inCountry.length} entries for ${endpoint.brand} in ${country}; cannot choose one.` };
  }

  // Exactly one row for the brand and no region on it. Still ambiguous: a single unlabelled row
  // might be any market, and this is the case that would quietly convert into the wrong country.
  return {
    error: `Betloy lists ${endpoint.brand} without a region matching ${country}; refusing rather than guessing the market.`,
  };
}

export function createBetloyRoute(config: BetloyConfig = {}): ConversionRoute & {
  listBookmakers(): Promise<BetloyBookmaker[]>;
  usage(): Promise<unknown>;
} {
  const apiKey = config.apiKey ?? process.env.BETLOY_API_KEY?.trim() ?? "";
  const baseUrl = config.baseUrl ?? process.env.BETLOY_BASE_URL?.trim() ?? DEFAULT_BASE;
  const doFetch = config.fetchImpl ?? fetch;
  const testMode = config.testMode === true;

  const url = (path: string) => `${baseUrl}${path}${testMode ? "?test=true" : ""}`;

  async function call(path: string, init: RequestInit): Promise<unknown> {
    if (!apiKey) {
      throw new AppError("BOOKMAKER_NOT_CONNECTED", "Conversions through Betloy aren't set up yet.");
    }
    let res: Response;
    try {
      res = await doFetch(url(path), {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Indeterminate, not failed: the provider may have done the work and we never heard. The
      // caller must decide whether a retry is safe, which is why nothing is retried in here.
      logger.warn("betloy.unreachable", { path, err });
      throw new AppError("BOOKMAKER_UNAVAILABLE", "The conversion service didn't respond.", { cause: err });
    }

    if (res.status === 401 || res.status === 403) {
      logger.error("betloy.auth_failed", { status: res.status });
      throw new AppError("BOOKMAKER_NOT_CONNECTED", "Conversions through Betloy aren't available right now.");
    }
    if (res.status === 402) throw new BetloyCreditsExhausted();
    if (res.status === 429) {
      throw new AppError("RATE_LIMITED", "Too many conversions right now. Please try again shortly.");
    }
    if (!res.ok) {
      logger.error("betloy.http_error", { path, status: res.status });
      throw new AppError("BOOKMAKER_UNAVAILABLE", "The conversion service couldn't complete that.");
    }
    const body = await res.json().catch(() => null);
    if (body === null) {
      throw new AppError("BOOKMAKER_UNAVAILABLE", "The conversion service returned something unreadable.");
    }
    return body;
  }

  return {
    id: "betloy",
    configured: apiKey.length > 0,

    /** Free per the documented contract. Used by the harness before anything is spent. */
    async listBookmakers(): Promise<BetloyBookmaker[]> {
      const body = (await call("/bookmakers", { method: "GET" })) as
        | { data?: BetloyBookmaker[] }
        | BetloyBookmaker[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      return rows.filter((b): b is BetloyBookmaker => typeof b?.id === "number");
    },

    /** Free per the documented contract. The only authoritative source for the allowance. */
    usage(): Promise<unknown> {
      return call("/usage", { method: "GET" });
    },

    /**
     * Whether this pair is worth attempting.
     *
     * Deliberately cannot answer on its own: the real check needs the bookmaker list, which is a
     * network call. This returns true only for shapes that could ever work, and the harness does
     * the authoritative check with [resolveEndpoint] before spending a credit.
     */
    supports(from: RouteEndpoint, to: RouteEndpoint): boolean {
      if (!apiKey) return false;
      return !(from.brand.toLowerCase() === to.brand.toLowerCase() && from.country === to.country);
    },

    async convert({ from, to, code, idempotencyKey }): Promise<RouteResult> {
      if (!this.supports(from, to)) {
        throw new AppError("BAD_REQUEST", "That conversion isn't a route Betloy can take.");
      }

      const list = await this.listBookmakers();
      const fromId = resolveEndpoint(list, from);
      const toId = resolveEndpoint(list, to);
      if ("error" in fromId) throw new AppError("BAD_REQUEST", fromId.error);
      if ("error" in toId) throw new AppError("BAD_REQUEST", toId.error);

      const body = (await call("/convert", {
        method: "POST",
        // Not documented as supported by Betloy, but harmless if ignored and correct if honoured.
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          booking_code: code,
          from_bookie_id: fromId.id,
          to_bookie_id: toId.id,
        }),
      })) as BetloyResponse;

      // A 200 is a response, not a booking code. Betloy charges a credit for this call either way,
      // which is all the more reason to be strict about what counts as a result.
      const converted = body.data?.converted_code?.trim();
      if (body.success === false || !converted) {
        throw new AppError("INVALID_CODE", body.message ?? "That code couldn't be converted.");
      }

      const legs = Array.isArray(body.data?.legs) ? body.data!.legs! : [];
      const flagged = Array.isArray(body.data?.flagged) ? body.data!.flagged! : [];

      // The published sample response omits `legs` and `flagged` while the FAQ and SDK reference
      // them, so the shape is genuinely unknown. Nothing is invented to fill it: the leg count
      // comes from the documented `number_of_events`, and the evaluation harness proves the
      // selections by reading the code back at the destination rather than trusting any of this.
      const matched: RouteSelection[] = legs.map((leg) => {
        const l = leg as Record<string, unknown>;
        return {
          eventName: String(l.event ?? l.eventName ?? l.match ?? ""),
          competition: (l.competition as string) ?? null,
          market: String(l.market ?? ""),
          selection: String(l.selection ?? l.pick ?? ""),
          line: (l.line as string) ?? null,
          startDate: (l.start_date as string) ?? (l.startDate as string) ?? null,
          sourceOdds: typeof l.source_odds === "number" ? l.source_odds : null,
          targetOdds: typeof l.target_odds === "number" ? l.target_odds : null,
          lineAdjusted: l.line_adjusted === true,
        };
      });

      const unmatched: RouteUnmatched[] = flagged.map((f) => {
        const u = f as Record<string, unknown>;
        return {
          eventName: String(u.event ?? u.eventName ?? ""),
          market: String(u.market ?? ""),
          selection: String(u.selection ?? ""),
          reason: String(u.reason ?? "flagged"),
          reasonText: String(u.message ?? u.reasonText ?? "This selection was flagged by the provider."),
        };
      });

      const events = body.data?.number_of_events ?? null;
      if (events === 0 || (legs.length === 0 && events === null && flagged.length === 0)) {
        // A code with nothing behind it, or a response that cannot show anything behind it. The
        // PariPesa failure: a coupon created, a code returned, zero events in it.
        logger.error("betloy.empty_conversion", { from: from.brand, to: to.brand });
        throw new AppError(
          "BOOKMAKER_UNAVAILABLE",
          "The conversion came back with nothing in it, so the code was not used.",
        );
      }

      return {
        targetCode: converted,
        expiresAt: null,
        matched,
        unmatched,
        sourceOddsTotal: null,
        targetOddsTotal: body.data?.total_odds ?? null,
        routeId: "betloy",
      };
    },
  };
}
