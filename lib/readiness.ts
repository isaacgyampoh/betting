// Which parts of the app are configured. Reports variable NAMES only, never values.

const REQUIRED = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

export type Readiness = {
  ready: boolean;
  missing: string[];
  features: { ai: boolean; payments: boolean; liveStats: boolean };
};

const set = (name: string) => !!process.env[name]?.trim();

export function readiness(): Readiness {
  const missing = REQUIRED.filter((k) => !set(k));
  return {
    ready: missing.length === 0,
    missing,
    features: { ai: set("ANTHROPIC_API_KEY"), payments: set("PAYSTACK_SECRET_KEY"), liveStats: set("API_FOOTBALL_KEY") },
  };
}
