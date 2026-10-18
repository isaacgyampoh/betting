/**
 * Reading the operator catalogue.
 *
 * The functions here are the only way the rest of the app should reach the catalogue, so that the
 * one rule it exists to enforce - a user is never offered a conversion that cannot happen - lives
 * in a single place rather than in every screen that lists bookmakers.
 */

import { AFRICA_CATALOGUE } from "./africa";
import { directionsFor, isUsable, type CatalogueEntry, type IntegrationStatus } from "./types";

export { AFRICA_CATALOGUE } from "./africa";
export * from "./types";
export * from "./providers";

/** Every entry, newest research first by country then brand. */
export function allEntries(): readonly CatalogueEntry[] {
  return AFRICA_CATALOGUE;
}

export function entryById(id: string): CatalogueEntry | undefined {
  return AFRICA_CATALOGUE.find((e) => e.id === id);
}

export function entriesForCountry(country: string): CatalogueEntry[] {
  return AFRICA_CATALOGUE.filter((e) => e.country === country.toUpperCase());
}

export function countries(): string[] {
  return [...new Set(AFRICA_CATALOGUE.map((e) => e.country))].sort();
}

/** Distinct brands, irrespective of how many markets each one appears in. */
export function brands(): string[] {
  return [...new Set(AFRICA_CATALOGUE.map((e) => e.brand))].sort();
}

/**
 * The entries a user may actually be offered.
 *
 * Note what this does *not* do: it never falls back to "everything we know about". A catalogue
 * entry is a research note, and the gap between 95 operators researched and 2 that can issue a
 * code is the entire point of keeping the two ideas apart.
 */
export function usableEntries(): CatalogueEntry[] {
  return AFRICA_CATALOGUE.filter(isUsable);
}

export function sources(): CatalogueEntry[] {
  return usableEntries().filter((e) => e.capabilities.readsCodes);
}

export function destinations(): CatalogueEntry[] {
  return usableEntries().filter((e) => e.capabilities.issuesCodes);
}

/** Working conversion directions, counted from what each side can really do. */
export function directions() {
  return directionsFor(AFRICA_CATALOGUE);
}

export type CoverageSummary = {
  countries: number;
  brands: number;
  entries: number;
  byStatus: Record<IntegrationStatus, number>;
  sources: number;
  destinations: number;
  directions: number;
};

/**
 * The numbers, computed rather than written down.
 *
 * Every figure in a coverage report should come from here. A hand-maintained count is a claim that
 * drifts from the data the moment anything changes, and coverage claims are exactly the kind that
 * get quoted back later.
 */
export function coverage(): CoverageSummary {
  const byStatus = {} as Record<IntegrationStatus, number>;
  for (const e of AFRICA_CATALOGUE) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  }
  return {
    countries: countries().length,
    brands: brands().length,
    entries: AFRICA_CATALOGUE.length,
    byStatus,
    sources: sources().length,
    destinations: destinations().length,
    directions: directions().length,
  };
}
