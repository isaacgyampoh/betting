import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";

// Cloudflare Workers forbid reusing a connection opened by one request in another, so on Workers
// each request gets its own client. Under Node (next dev, tests, scripts) one client per process
// is reused.

type CfRequest = { ctx: object };

function cloudflareRequest(): CfRequest | null {
  try {
    return getCloudflareContext() as unknown as CfRequest;
  } catch {
    return null; // not running on Workers
  }
}

// On Workers every query is a hop to the database before the page can render, so how many a page
// makes is a thing worth being able to assert. Setting DB_QUERY_LOG=1 makes the client emit one
// event per query; nothing reads it unless a test asks.
export const queryCounter = { count: 0 };

/**
 * TLS settings for a connection string, where the URL alone cannot say it.
 *
 * Render's Postgres requires TLS and presents a **self-signed** certificate. Newer node-postgres
 * reads `sslmode=require` as verify-full, so it refuses that certificate outright - the error is
 * `Error opening a TLS connection: self-signed certificate`, which reaches the health endpoint as
 * a bare `database_unreachable` and says nothing about the real cause. Putting
 * `uselibpqcompat=true` in the URL does not help either, because PrismaPg hands the string to
 * pg.Pool, which does not act on it.
 *
 * So the host decides, and only one host qualifies: Render's **internal** name, the bare
 * `dpg-...` with no dots, reachable only from inside their private network. That endpoint is the
 * self-signed one. Traffic to it is still encrypted; what is given up is proof of identity
 * against a peer nothing outside the private network can even route to.
 *
 * Render's *external* hostname is deliberately excluded. It presents a certificate signed by a
 * public CA - verified from this machine while migrating, with Prisma, over the public internet -
 * so relaxing it there would discard a check that works. Supabase and every other host keep the
 * default too. A blanket `rejectUnauthorized: false` would have been one line shorter and would
 * have quietly stopped verifying anything, anywhere.
 */
export function sslFor(connectionString: string) {
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return undefined;
  }
  // Bare internal name only: no dots, so it cannot be a public hostname.
  const renderInternal = /^dpg-[a-z0-9-]+$/.test(host);
  return renderInternal ? { rejectUnauthorized: false } : undefined;
}

function createClient(connectionString: string) {
  const ssl = sslFor(connectionString);
  const adapter = new PrismaPg({ connectionString, max: 3, ...(ssl ? { ssl } : {}) });
  if (process.env.DB_QUERY_LOG !== "1") return new PrismaClient({ adapter });
  const client = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
  client.$on("query", () => {
    queryCounter.count += 1;
  });
  return client;
}

const perRequest = new WeakMap<object, PrismaClient>();
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  const cf = cloudflareRequest();
  if (cf) {
    let client = perRequest.get(cf.ctx);
    if (!client) {
      // DATABASE_URL, which on Cloudflare will not reach the database: gameclaw-db accepts no
      // external connections. That is deliberate rather than an oversight - worker.ts forwards
      // /api/v1 to the API on Render instead of serving it, so nothing at the edge should arrive
      // here at all.
      //
      // There is no Hyperdrive branch any more. The binding went when the forwarder landed, and
      // the configuration itself (673d415bb1174f8092e5649a5675516a, still pointing at the deleted
      // Supabase pooler) was deleted on 2026-10-31 together with the second Worker that was the
      // last thing binding it. No Cloudflare Worker now has a database connection of any kind.
      // This path survives so a stray query from the edge fails plainly rather than being routed
      // somewhere unexpected.
      client = createClient(env().DATABASE_URL);
      perRequest.set(cf.ctx, client);
    }
    return client;
  }
  globalForPrisma.prisma ??= createClient(env().DATABASE_URL);
  return globalForPrisma.prisma;
}

/** Lazily connected Prisma client, so importing it never requires env vars (e.g. during `next build`). */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
