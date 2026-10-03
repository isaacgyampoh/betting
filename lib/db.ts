import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";

// Cloudflare Workers forbid reusing a connection opened by one request in another, so on Workers
// each request gets its own client (cheap with Hyperdrive, which pools connections near the DB).
// Under Node (next dev, tests, scripts) one client per process is reused.

type CfRequest = { ctx: object; env: { HYPERDRIVE?: { connectionString: string } } };

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

function createClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString, max: 3 });
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
      // Hyperdrive when bound; otherwise the pooled Supabase URL (DATABASE_URL secret).
      client = createClient(cf.env.HYPERDRIVE?.connectionString ?? env().DATABASE_URL);
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
