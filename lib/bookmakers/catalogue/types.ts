/**
 * The operator catalogue: who exists, where, and how far we have actually got with them.
 *
 * This sits above the adapters rather than inside them. An adapter is code that talks to one
 * bookmaker; a catalogue entry is a fact about an operator in a market, and most entries will
 * never have an adapter. Keeping them apart is what stops the catalogue turning into a list of
 * names in a dropdown that the conversion screen cannot honour.
 *
 * The entries live in version control rather than the database on purpose. They are research, and
 * research is reviewed in a diff: when a status moves from `researching` to `live-verified`,
 * somebody should be able to see what evidence moved it. The `bookmakers` table stays what it is -
 * the operational row for an integration that really runs.
 */

import type { BookmakerSlug } from "@/lib/bookmakers/types";

/**
 * How far an integration has got, with no room between the rungs for wishful thinking.
 *
 * The distinction that matters most is the last two steps. `sandbox-verified` means it worked
 * somewhere that was not production; `live-verified` means a real destination code was created at
 * the real bookmaker and read back with the same selections. Nothing else earns that word, and a
 * reader of this file should be able to trust it without checking.
 */
export const INTEGRATION_STATUSES = [
  /** The operator is identified and recorded. Nothing technical has been attempted. */
  "catalogued",
  /** We are working out whether an integration is possible at all. */
  "researching",
  /** Technically possible, blocked on credentials, a contract or a partner agreement. */
  "awaiting-authorisation",
  /** Proven against an authorised sandbox or evaluation environment, not against production. */
  "sandbox-verified",
  /** A real destination code was created and read back. The only status that promises anything. */
  "live-verified",
  /** Some directions or operations work and others do not; `limits` says which. */
  "partially-supported",
  /** The operator or its infrastructure refuses us, or the market is closed to us. */
  "unavailable",
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Statuses a user may be offered a conversion from or to. Everything else is informational. */
export const USABLE_STATUSES: readonly IntegrationStatus[] = ["live-verified", "partially-supported"];

/**
 * How we know the operator serves this market.
 *
 * Deliberately not "is licensed". We checked: national registers are either not published in a
 * machine-readable form or not reachable, and the secondary sources contradict each other badly -
 * three of them put Ghana's licensed-operator count at 55, 90 and 28. An unverified licence claim
 * in a field called `licensed` would be worse than no field at all, so licence status is recorded
 * only where a register was actually read, and is absent otherwise.
 */
export type Presence =
  /** The operator's own country site answered. The strongest evidence available without a licence register. */
  | { kind: "site-reachable"; url: string; httpStatus: number; checkedAt: string }
  /**
   * The host exists and refused us - a WAF, a geo-block or an anti-bot rule.
   *
   * This is evidence of two different things at once: the operator does serve the market, and an
   * integration will have to be agreed rather than simply written. MSport is the worked example.
   */
  | { kind: "site-blocked"; url: string; httpStatus: number; checkedAt: string }
  /** No host answered at the expected address. Often means the brand does not serve this market. */
  | { kind: "no-host"; url: string; checkedAt: string }
  /** Reported by press or an aggregator and not independently checked. Treat as a lead. */
  | { kind: "secondary"; source: string; checkedAt: string };

/** What an integration can do, once there is one. */
export type CatalogueCapabilities = {
  /** Can a booking code issued here be read into a slip? */
  readsCodes: boolean;
  /** Can a new booking code be created here? */
  issuesCodes: boolean;
};

export type CatalogueEntry = {
  /** Stable identifier, `brand-country`. Never reused and never renamed once published. */
  id: string;
  /** The brand as the operator writes it. */
  brand: string;
  /** ISO 3166-1 alpha-2. A brand in two countries is two entries: different fixtures and odds. */
  country: string;
  website: string;
  status: IntegrationStatus;
  capabilities: CatalogueCapabilities;
  /**
   * The adapter serving this entry, where one exists. Absent for every entry we have only
   * catalogued, which is most of them.
   */
  adapter?: BookmakerSlug;
  presence: Presence;
  /**
   * The body that licenses betting in this market, where it is well established.
   *
   * Naming the regulator is not a claim that this operator holds a licence from it - see
   * [Presence]. It is here so that a partnership request knows who to cite.
   */
  regulator?: string;
  /** Why the status is what it is. Required for anything a user could be refused. */
  reason?: string;
  /** For `partially-supported`: what specifically does not work. */
  limits?: string[];
  /** When the status was last established, ISO date. */
  verifiedAt: string;
};

/** Every status that means "a user cannot convert here", with the reason they should be shown. */
export function isUsable(entry: CatalogueEntry): boolean {
  return USABLE_STATUSES.includes(entry.status);
}

/**
 * A conversion direction: read a code at `from`, issue one at `to`.
 *
 * Counted rather than declared, because the number of directions is the product of what each side
 * can really do and is the single most misquoted figure in this domain. A catalogue of 200
 * operators with two working integrations has two directions, not 39,800.
 */
export type Direction = { from: string; to: string };

export function directionsFor(entries: readonly CatalogueEntry[]): Direction[] {
  const sources = entries.filter((e) => isUsable(e) && e.capabilities.readsCodes);
  const destinations = entries.filter((e) => isUsable(e) && e.capabilities.issuesCodes);
  const out: Direction[] = [];
  for (const from of sources) {
    for (const to of destinations) {
      // Converting a slip to the bookmaker it came from is not a conversion.
      if (from.id !== to.id) out.push({ from: from.id, to: to.id });
    }
  }
  return out;
}
