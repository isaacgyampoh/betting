// Which parts of the app are configured. Reports variable NAMES only, never values.

const REQUIRED = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

export type Readiness = {
  ready: boolean;
  missing: string[];
  features: { ai: boolean; payments: boolean; liveStats: boolean; push: boolean };
};

const set = (name: string) => !!process.env[name]?.trim();

export function readiness(): Readiness {
  const missing = REQUIRED.filter((k) => !set(k));
  return {
    ready: missing.length === 0,
    missing,
    features: {
      ai: set("ANTHROPIC_API_KEY"),
      payments: set("PAYSTACK_SECRET_KEY"),
      liveStats: set("API_FOOTBALL_KEY"),
      // FCM_SERVICE_ACCOUNT is `sync: false`, so it is set in the Render dashboard and nothing in
      // this repository can say whether it is present. Without this flag the only way to find out
      // was to sign in on a phone and press the test button, and a silent failure there looks
      // identical to a notification that was sent and swallowed by the device.
      push: set("FCM_SERVICE_ACCOUNT"),
    },
  };
}
