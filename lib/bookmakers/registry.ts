import { createBetwayAdapter } from "@/lib/bookmakers/betway";
import { createSportyBetAdapter } from "@/lib/bookmakers/sportybet";
import { BOOKMAKER_SLUGS, type AdapterMode, type BookmakerAdapter, type BookmakerSlug } from "@/lib/bookmakers/types";

const FACTORIES: Record<BookmakerSlug, (mode: AdapterMode) => BookmakerAdapter> = {
  sportybet: createSportyBetAdapter,
  betway: createBetwayAdapter,
};

// e.g. SPORTYBET_MODE=live. Defaults to mock until the live adapter is implemented.
function modeFor(slug: BookmakerSlug): AdapterMode {
  return process.env[`${slug.toUpperCase()}_MODE`] === "live" ? "live" : "mock";
}

const cache = new Map<BookmakerSlug, BookmakerAdapter>();

export function isBookmakerSlug(value: string): value is BookmakerSlug {
  return (BOOKMAKER_SLUGS as readonly string[]).includes(value);
}

export function getAdapter(slug: BookmakerSlug): BookmakerAdapter {
  let adapter = cache.get(slug);
  if (!adapter) {
    adapter = FACTORIES[slug](modeFor(slug));
    cache.set(slug, adapter);
  }
  return adapter;
}
