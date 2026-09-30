import "server-only";
import { publicEnv } from "@/lib/public-env";

const TTL_MS = 5 * 60_000;
let cached: { value: { google: boolean }; at: number } | null = null;

/** Sign-in methods enabled in Supabase (public settings endpoint), cached in memory for 5 minutes. */
export async function enabledProviders(): Promise<{ google: boolean }> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: publicEnv.supabaseAnonKey },
      cache: "no-store",
    });
    if (!res.ok) return cached?.value ?? { google: false };
    const body = (await res.json()) as { external?: Record<string, boolean> };
    cached = { value: { google: !!body.external?.google }, at: Date.now() };
    return cached.value;
  } catch {
    return cached?.value ?? { google: false };
  }
}
