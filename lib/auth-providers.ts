import "server-only";
import { publicEnv } from "@/lib/public-env";

/** Sign-in methods enabled in Supabase (public settings endpoint), cached for 5 minutes. */
export async function enabledProviders(): Promise<{ google: boolean }> {
  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: publicEnv.supabaseAnonKey },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { google: false };
    const body = (await res.json()) as { external?: Record<string, boolean> };
    return { google: !!body.external?.google };
  } catch {
    return { google: false };
  }
}
