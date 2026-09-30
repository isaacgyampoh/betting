import "server-only";
import { z } from "zod";

// Keys for later milestones are optional so the app boots before they are configured;
// the service that needs one calls requireEnv() and fails with a clear message.
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  IP_HASH_SALT: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  API_FOOTBALL_KEY: z.string().min(1).optional(),
  PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  // Treat empty strings (e.g. `KEY=` in .env files) as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables (see .env.example):\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = env()[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${key} (see .env.example)`);
  }
  return value as NonNullable<ServerEnv[K]>;
}
