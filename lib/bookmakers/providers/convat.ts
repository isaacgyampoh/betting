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
 * The Convat conversion API, as a route.
 *
 * Written against the published contract at convat.io/api (read 2026-10-18) and **not yet run
 * against the service**: there is no key, because getting one means signing an evaluation
 * agreement, which is the owner's decision. Everything here is therefore exercised against
 * documented fixtures and is labelled as such in the tests. No route is `live-verified` on the
 * strength of this file.
 *
 * Documented contract:
 *   POST {base}/v1/convert
 *   Authorization: Bearer <key>        Idempotency-Key: <key>
 *   { source, target, code }
 *   -> { success, targetCode, matched, total, matchedSelections[], unmatched[], ...OddsTotal }
 *
 * Charging is one credit per conversion that returns a destination code; failures, previews and
 * retries are free. A retry with the same Idempotency-Key returns the first result and never books
 * twice. Convat recommends a 60-second client timeout because a slow bookmaker can take about a
 * minute.
 *
 * Two things the published contract does not settle, and both are recorded here rather than
 * guessed at:
 *
 *  1. **Country.** The request body is `source`, `target`, `code` with no country field, while
 *     GameClaw addresses bookmakers as brand-and-country because SportyBet Ghana and SportyBet
 *     Nigeria are different fixtures at different prices. Until Convat confirms how a market is
 *     selected, [supports] refuses any pair whose countries differ, and the single-country pairs
 *     it does accept are the only ones an evaluation should start with.
 *  2. **Rate limits and retention.** Neither is published. `RATE_LIMITED` is mapped from HTTP 429
 *     so the behaviour is right whatever the numbers turn out to be.
 */

/** Documented evaluation host. A production key is expected to move this; hence the override. */
const DEFAULT_BASE = "https://eval-api.convat.io";

/** Convat's own guidance: a slow bookmaker can take about a minute. */
const TIMEOUT_MS = 60_000;

type ConvatSelection = {
  eventName?: string;
  competition?: string | null;
  market?: string;
  selection?: string;
  line?: string | null;
  startDate?: string | null;
  sourceOdds?: number | null;
  targetOdds?: number | null;
  lineAdjusted?: boolean;
};

type ConvatUnmatched = {
  eventName?: string;
  market?: string;
  selection?: string;
  reason?: string;
  reasonText?: string;
};

type ConvatResponse = {
  success?: boolean;
  targetCode?: string | null;
  matched?: number;
  total?: number;
  sourceOddsTotal?: number | null;
  targetOddsTotal?: number | null;
  matchedSelections?: ConvatSelection[];
  unmatched?: ConvatUnmatched[];
};

/**
 * Brands Convat's own converter lists, lower-cased.
 *
 * A marketing list, deliberately treated as nothing more: it decides which pairs are worth
 * *attempting*, never what works. Only a real conversion with a readback moves anything to
 * `live-verified`.
 */
const CLAIMED_BOTH = new Set([
  "1xbet", "22bet", "betking", "betwinner", "paripesa", "msport", "football.com", "betway",
  "helabet", "melbet", "betpawa", "megapari", "afropari", "bangbet", "odibets", "linebet",
  "1win", "888starz", "easybet", "livescore bet", "nairabet", "bc.game", "betjam", "betkadio",
]);
const CLAIMED_SOURCE_ONLY = new Set(["bet9ja", "betano", "betika", "mozzart", "sportpesa", "meridianbet"]);
const CLAIMED_DESTINATION_ONLY = new Set(["sportybet"]);

const canSource = (brand: string) => {
  const b = brand.toLowerCase();
  return CLAIMED_BOTH.has(b) || CLAIMED_SOURCE_ONLY.has(b);
};
const canDestination = (brand: string) => {
  const b = brand.toLowerCase();
  return CLAIMED_BOTH.has(b) || CLAIMED_DESTINATION_ONLY.has(b);
};

export type ConvatConfig = {
  apiKey?: string;
  baseUrl?: string;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export function createConvatRoute(config: ConvatConfig = {}): ConversionRoute {
  // Read at construction, never logged, never returned. The key lives only in the Authorization
  // header of an outbound request.
  const apiKey = config.apiKey ?? process.env.CONVAT_API_KEY?.trim() ?? "";
  const baseUrl = config.baseUrl ?? process.env.CONVAT_BASE_URL?.trim() ?? DEFAULT_BASE;
  const doFetch = config.fetchImpl ?? fetch;

  return {
    id: "convat",
    configured: apiKey.length > 0,

    supports(from: RouteEndpoint, to: RouteEndpoint): boolean {
      if (!apiKey) return false;
      if (from.brand.toLowerCase() === to.brand.toLowerCase() && from.country === to.country) {
        return false;
      }
      // Until Convat says how a market is chosen, a cross-country pair cannot be expressed safely.
      // Refusing is the conservative direction: the failure it avoids is a code that books the
      // right teams at the wrong country's prices, which looks correct to everyone involved.
      if (from.country !== to.country) return false;
      return canSource(from.brand) && canDestination(to.brand);
    },

    async convert({ from, to, code, idempotencyKey }): Promise<RouteResult> {
      if (!apiKey) {
        throw new AppError("BOOKMAKER_NOT_CONNECTED", "Conversions through Convat aren't set up yet.");
      }
      if (!this.supports(from, to)) {
        throw new AppError(
          "BAD_REQUEST",
          `Convat doesn't cover ${from.brand} (${from.country}) to ${to.brand} (${to.country}).`,
        );
      }

      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/v1/convert`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ source: from.brand, target: to.brand, code }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        // A timeout is not a failed conversion: the provider may have booked. The caller must
        // retry with the same idempotency key rather than start again.
        logger.warn("convat.unreachable", { from: from.brand, to: to.brand, err });
        throw new AppError("BOOKMAKER_UNAVAILABLE", "The conversion service didn't respond. Please try again.", {
          cause: err,
        });
      }

      if (res.status === 401 || res.status === 403) {
        // Ours to fix, and never the user's fault - so it must not read like a bookmaker problem.
        logger.error("convat.auth_failed", { status: res.status });
        throw new AppError("BOOKMAKER_NOT_CONNECTED", "Conversions through Convat aren't available right now.");
      }
      if (res.status === 429) {
        throw new AppError("RATE_LIMITED", "Too many conversions right now. Please try again shortly.");
      }
      if (!res.ok) {
        logger.error("convat.http_error", { status: res.status });
        throw new AppError("BOOKMAKER_UNAVAILABLE", "The conversion service couldn't complete that.");
      }

      const body = (await res.json().catch(() => null)) as ConvatResponse | null;
      if (!body) {
        throw new AppError("BOOKMAKER_UNAVAILABLE", "The conversion service returned something unreadable.");
      }

      // The rule this whole file exists to hold: a 200 is not a booking code. Convat charges a
      // credit only when it returns one, which is the same line we draw - no code, no conversion,
      // and nothing invented to fill the gap.
      const targetCode = body.targetCode?.trim();
      if (body.success === false || !targetCode) {
        const why = body.unmatched?.[0]?.reasonText;
        throw new AppError("INVALID_CODE", why ?? "That code couldn't be converted.");
      }

      const matched: RouteSelection[] = (body.matchedSelections ?? []).map((s) => ({
        eventName: s.eventName ?? "",
        competition: s.competition ?? null,
        market: s.market ?? "",
        selection: s.selection ?? "",
        line: s.line ?? null,
        startDate: s.startDate ?? null,
        sourceOdds: s.sourceOdds ?? null,
        targetOdds: s.targetOdds ?? null,
        lineAdjusted: s.lineAdjusted === true,
      }));

      const unmatched: RouteUnmatched[] = (body.unmatched ?? []).map((u) => ({
        eventName: u.eventName ?? "",
        market: u.market ?? "",
        selection: u.selection ?? "",
        reason: u.reason ?? "unknown",
        reasonText: u.reasonText ?? "This selection could not be carried across.",
      }));

      // A code with no legs behind it is the PariPesa failure by another name: a coupon that is
      // created, returns a code, and contains nothing. Refuse it rather than hand it over.
      if (matched.length === 0) {
        logger.error("convat.empty_conversion", { from: from.brand, to: to.brand });
        throw new AppError(
          "BOOKMAKER_UNAVAILABLE",
          "The conversion came back with no selections, so the code was not used.",
        );
      }

      return {
        targetCode,
        expiresAt: null, // Not in the documented response; absent rather than guessed.
        matched,
        unmatched,
        sourceOddsTotal: body.sourceOddsTotal ?? null,
        targetOddsTotal: body.targetOddsTotal ?? null,
        routeId: "convat",
      };
    },
  };
}
