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
import { AppError } from "@/lib/errors";

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

/**
 * Whether sample bookmaker data may be served. Off in production: a user must never be shown an
 * invented slip, price or booking code. Local development and tests keep the mocks so the whole app
 * is still exercisable without nine live integrations.
 */
export function sampleDataAllowed(): boolean {
  if (process.env.ALLOW_SAMPLE_DATA === "1") return true;
  if (process.env.ALLOW_SAMPLE_DATA === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Bookmakers whose own servers refuse us, with the reason.
 *
 * Not the same thing as unfinished. MSport's integration works: the endpoints are right, the
 * market mapping is right, and every one of them answers 200 from an ordinary connection. From
 * the deployed Worker the identical request comes back 403 - repeatedly, on every endpoint,
 * while SportyBet and Football.com answer the same Worker without complaint. That is MSport
 * deciding not to serve this origin, not an outage and not a bug on our side.
 *
 * It stays listed here rather than being deleted or quietly left to fail, because the integration
 * is finished and the block is theirs to lift. Getting it working again is an agreement with
 * MSport - an allowlist, or an official integration - not something to engineer around. Working
 * around a provider's own access control would be both a breach of their terms and a thing we
 * would have to keep secret from them, which is a good sign it is the wrong move.
 *
 * Removing a slug from this map is all it takes to switch one back on.
 */
export const REFUSED_BY_BOOKMAKER: Partial<Record<BookmakerSlug, string>> = {
  msport: "MSport is not accepting requests from our servers at the moment.",
};

/**
 * A bookmaker that is implemented but is turning us away.
 *
 * Reads as unavailable everywhere a bookmaker's capabilities are shown, and says why rather than
 * implying we never built it. Code detection and market mapping still work, so a pasted MSport
 * code is still recognised as an MSport code and named as one.
 */
function refusedByBookmaker(adapter: BookmakerAdapter, reason: string): BookmakerAdapter {
  const refuse = async (): Promise<never> => {
    throw new AppError("BOOKMAKER_NOT_CONNECTED", `${reason} Your code is fine - try another destination.`);
  };
  return {
    ...adapter,
    capabilities: { loadCode: false, createCode: false, events: false },
    loadCode: refuse,
    createCode: refuse,
    searchEvent: refuse,
    getEventMarkets: refuse,
  };
}

/**
 * A bookmaker we cannot talk to yet. Code-format detection and market mapping still work — they are
 * pure functions and let us tell the user *which* bookmaker they pasted — but every request for real
 * data refuses instead of inventing it.
 */
function notConnected(adapter: BookmakerAdapter): BookmakerAdapter {
  const refuse = async (): Promise<never> => {
    throw new AppError(
      "BOOKMAKER_NOT_CONNECTED",
      `We can't open ${adapter.name} booking codes yet while we finish connecting it. Your code is probably fine.`,
    );
  };
  return {
    ...adapter,
    capabilities: { loadCode: false, createCode: false, events: false },
    loadCode: refuse,
    createCode: refuse,
    searchEvent: refuse,
    getEventMarkets: refuse,
  };
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
    const mode = modeFor(slug);
    adapter = FACTORIES[slug](mode, latency !== undefined ? { latencyMs: Number(latency) } : {});
    if (mode === "mock" && !sampleDataAllowed()) adapter = notConnected(adapter);
    const refusal = REFUSED_BY_BOOKMAKER[slug];
    if (refusal) adapter = refusedByBookmaker(adapter, refusal);
    cache.set(slug, adapter);
  }
  return adapter;
}

/** Bookmakers whose live integration really works, for telling the user what we can do today. */
export function connectedBookmakers(): BookmakerAdapter[] {
  return BOOKMAKER_SLUGS.map(getAdapter).filter((a) => a.capabilities.loadCode || a.capabilities.events);
}

/** For tests: build an adapter directly (bypasses the cache and env). */
export function createAdapter(slug: BookmakerSlug, mode: AdapterMode, opts?: { latencyMs?: number }): BookmakerAdapter {
  return FACTORIES[slug](mode, opts);
}
