import "server-only";
import { logger } from "@/lib/logger";
import { createBetloyRoute } from "./betloy";
import { createConvatRoute } from "./convat";
import type { ConversionRoute, RouteEndpoint } from "./types";

/**
 * Which conversion routes exist, and which one claims a given pair.
 *
 * The native route - load the slip through our own adapter, match each fixture, book at the
 * destination - stays the default everywhere it works, because it is free, it produces a real
 * per-leg breakdown, and it links the matched events so the next conversion is faster. A provider
 * is only consulted for a pair the native route cannot serve at all.
 *
 * That is most pairs today. Of the nine bookmakers in the catalogue only two can both read and
 * issue a code; the rest are waiting on an authorised integration, which is a commercial
 * arrangement rather than a missing function. A provider route is the one way to cover them
 * without one, and both implementations here were written against published contracts and are
 * unconfigured until somebody supplies a key.
 *
 * Order matters. Betloy is first because it resolves bookmakers by numeric id from a free endpoint
 * that carries a region, so a Ghana slip cannot quietly become a Nigeria code; Convat takes brand
 * names with no country field, and refuses cross-country pairs for that reason.
 */
function allRoutes(): ConversionRoute[] {
  return [createBetloyRoute(), createConvatRoute()];
}

/** Only the routes that have a key. An unconfigured route is a configuration state, not an error. */
export function configuredRoutes(): ConversionRoute[] {
  return allRoutes().filter((r) => r.configured);
}

/**
 * The route that claims this pair, or null.
 *
 * Never throws: a missing route is the ordinary case and the caller falls back to telling the
 * user plainly that this pair is not connected yet.
 */
export function routeFor(from: RouteEndpoint, to: RouteEndpoint): ConversionRoute | null {
  for (const route of configuredRoutes()) {
    try {
      if (route.supports(from, to)) return route;
    } catch (err) {
      // A route that throws while deciding is a broken route, not a failed conversion. Skip it
      // and let the next one answer rather than failing the whole request.
      logger.warn("routes.supports_threw", { route: route.id, err: String(err).slice(0, 200) });
    }
  }
  return null;
}

/** For the readiness endpoint and the Convert screen: which providers are live, if any. */
export function routeStatus(): { id: string; configured: boolean }[] {
  return allRoutes().map((r) => ({ id: r.id, configured: r.configured }));
}
