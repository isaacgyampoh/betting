import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/public-env";

export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
