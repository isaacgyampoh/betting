import { logger } from "@/lib/logger";

/**
 * Reading public data from the API instead of from Postgres.
 *
 * The website runs on Cloudflare and the API runs on Render, and only one of them can reach the
 * database: `gameclaw-db` permits no external connections (`ipAllowList: []`), so the Worker's
 * Hyperdrive binding cannot connect and every DB-backed page on gameclaw.win returns 500.
 *
 * The alternative was to open the database to the internet. Cloudflare's own documentation says
 * Hyperdrive egresses from Cloudflare's general IP ranges, and those ranges are shared by every
 * Cloudflare customer - so allowlisting them is only marginally narrower than allowlisting
 * everybody, and the database would be reachable from outside Render either way. Routing the two
 * public, read-only pages through the API that already holds a connection keeps the database shut.
 *
 * Only reads, and only public ones. Nothing here carries a token, so nothing user-specific can be
 * fetched this way by accident.
 *
 * Unset on Render, where `GC_DATA_API_BASE` has no value and every caller goes straight to Prisma
 * exactly as before.
 */
export function remoteDataBase(): string | null {
  const base = process.env.GC_DATA_API_BASE?.trim();
  return base ? base.replace(/\/$/, "") : null;
}

/**
 * Returns null rather than throwing, so a caller can fall through to the database.
 *
 * On the Worker that fallback then fails too and the page errors - which is correct and visible.
 * What it must not do is turn a reachable API into an error because of a blip, so this is the one
 * place a timeout is applied.
 */
export async function readViaApi<T>(path: string): Promise<T | null> {
  const base = remoteDataBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) {
      logger.warn("remote_data.not_ok", { path, status: res.status });
      return null;
    }
    const body = (await res.json()) as { data?: T };
    return body?.data ?? null;
  } catch (err) {
    logger.warn("remote_data.failed", { path, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
