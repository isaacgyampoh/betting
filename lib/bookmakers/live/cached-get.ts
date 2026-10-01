import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Cached JSON GET for bookmaker APIs, stored in the generic `stats_cache` KV table. Odds move,
// so TTLs here are short (seconds to minutes); the point is to collapse the burst of identical
// requests one user action causes, not to serve stale prices.

type Params = Record<string, string | number>;

function cacheKey(scope: string, endpoint: string, params: Params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha256").update(`${scope}|${endpoint}?${sorted}`).digest("hex");
}

export type CachedGetOptions = {
  scope: string;
  baseUrl: string;
  endpoint: string;
  params?: Params;
  ttlSeconds: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Treat as a cache miss rather than caching it (e.g. an empty list we don't trust). */
  cacheable?: (payload: unknown) => boolean;
};

/**
 * The cache is an optimisation, never a dependency: reaching `db` throws synchronously when the
 * database is not configured, so both sides are fully guarded. A cache outage must not stop a user
 * loading their slip.
 */
async function readCache(key: string): Promise<{ payload: unknown; expiresAt: Date } | null> {
  try {
    return await db.statsCache.findUnique({ where: { key }, select: { payload: true, expiresAt: true } });
  } catch {
    return null;
  }
}

async function writeCache(key: string, endpoint: string, params: Params, payload: unknown, expiresAt: Date): Promise<void> {
  try {
    await db.statsCache.upsert({
      where: { key },
      create: { key, endpoint, params, payload: payload as never, expiresAt },
      update: { payload: payload as never, expiresAt, fetchedAt: new Date() },
    });
  } catch (error) {
    logger.warn("bookmaker.cache_write_failed", { endpoint, error: String(error) });
  }
}

export async function cachedGet<T>(opts: CachedGetOptions): Promise<T> {
  const { scope, baseUrl, endpoint, params = {}, ttlSeconds, headers = {}, timeoutMs = 10_000 } = opts;
  const key = cacheKey(scope, endpoint, params);

  const hit = await readCache(key);
  if (hit && hit.expiresAt > new Date()) return hit.payload as T;

  const url = new URL(endpoint, baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    // A stale cached body beats an error page the user can do nothing about.
    if (hit) {
      logger.warn("bookmaker.fetch_failed_serving_stale", { scope, endpoint, error: String(error) });
      return hit.payload as T;
    }
    logger.error("bookmaker.fetch_failed", { scope, endpoint, error: String(error) });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "We couldn't reach the bookmaker. Please try again in a moment.");
  }
  clearTimeout(timer);

  if (!res.ok) {
    if (hit) {
      logger.warn("bookmaker.http_error_serving_stale", { scope, endpoint, status: res.status });
      return hit.payload as T;
    }
    logger.error("bookmaker.http_error", { scope, endpoint, status: res.status });
    throw new AppError("BOOKMAKER_UNAVAILABLE", "The bookmaker isn't responding right now. Please try again in a moment.");
  }

  const payload = (await res.json()) as T;
  if (!opts.cacheable || opts.cacheable(payload)) {
    await writeCache(key, `${scope}:${endpoint}`, params, payload, new Date(Date.now() + ttlSeconds * 1000));
  }
  return payload;
}
