import { createOneXBetAdapter } from "@/lib/bookmakers/1xbet";
import { createTwentyTwoBetAdapter } from "@/lib/bookmakers/22bet";
import { createBetPawaAdapter } from "@/lib/bookmakers/betpawa";
import { createBetwayAdapter } from "@/lib/bookmakers/betway";
import { createBetwinnerAdapter } from "@/lib/bookmakers/betwinner";
import { createFootballComAdapter } from "@/lib/bookmakers/footballcom";
import { createMSportAdapter } from "@/lib/bookmakers/msport";
import { createPariPesaAdapter } from "@/lib/bookmakers/paripesa";
import { createSportyBetAdapter } from "@/lib/bookmakers/sportybet";
import { BOOKMAKER_SLUGS, type AdapterMode, type BookmakerAdapter, type BookmakerSlug } from "@/lib/bookmakers/types";

type Factory = (mode: AdapterMode, opts?: { latencyMs?: number }) => BookmakerAdapter;

const FACTORIES: Record<BookmakerSlug, Factory> = {
  sportybet: createSportyBetAdapter,
  betway: createBetwayAdapter,
  "1xbet": createOneXBetAdapter,
  betpawa: createBetPawaAdapter,
  msport: createMSportAdapter,
  footballcom: createFootballComAdapter,
  betwinner: createBetwinnerAdapter,
  "22bet": createTwentyTwoBetAdapter,
  paripesa: createPariPesaAdapter,
};

/** Env var that switches a bookmaker to live mode, e.g. SPORTYBET_MODE, ONEXBET_MODE, TWENTYTWOBET_MODE. */
export function modeEnvVar(slug: BookmakerSlug): string {
  const base = slug.replace(/^1x/, "onex").replace(/^22/, "twentytwo").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `${base}_MODE`;
}

// Defaults to mock until the bookmaker's live adapter is implemented.
function modeFor(slug: BookmakerSlug): AdapterMode {
  return process.env[modeEnvVar(slug)] === "live" ? "live" : "mock";
}

const cache = new Map<BookmakerSlug, BookmakerAdapter>();

export function isBookmakerSlug(value: string): value is BookmakerSlug {
  return (BOOKMAKER_SLUGS as readonly string[]).includes(value);
}

export function getAdapter(slug: BookmakerSlug): BookmakerAdapter {
  let adapter = cache.get(slug);
  if (!adapter) {
    // MOCK_LATENCY_MS overrides the simulated network delay (tests set it to 0).
    const latency = process.env.MOCK_LATENCY_MS;
    adapter = FACTORIES[slug](modeFor(slug), latency !== undefined ? { latencyMs: Number(latency) } : {});
    cache.set(slug, adapter);
  }
  return adapter;
}

/** For tests: build an adapter directly (bypasses the cache and env). */
export function createAdapter(slug: BookmakerSlug, mode: AdapterMode, opts?: { latencyMs?: number }): BookmakerAdapter {
  return FACTORIES[slug](mode, opts);
}
