import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

/** Salted hash of the client IP; the raw IP is never stored. */
export function clientIpHash(req: NextRequest): string | null {
  // Cloudflare sets cf-connecting-ip; x-forwarded-for covers other hosts and local dev.
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip");
  if (!ip) return null;
  return createHash("sha256").update(`${env().IP_HASH_SALT ?? "dev-salt"}:${ip}`).digest("hex").slice(0, 32);
}
