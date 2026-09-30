import "server-only";
import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type AuthUser = { id: string; email: string | null };

/**
 * Resolves the signed-in user from the Supabase session cookie (web) or an
 * `Authorization: Bearer <access_token>` header (mobile app, Telegram bot).
 */
export const getAuthUser = cache(async (authorization?: string | null): Promise<AuthUser | null> => {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (bearer) {
    const supabase = createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(bearer);
    if (error || !data) return null;
    return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
});

export async function requireUser(authorization?: string | null): Promise<AuthUser> {
  const user = await getAuthUser(authorization);
  if (!user) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  return user;
}

/** Loads the profile, creating it if the auth trigger hasn't (e.g. users created before the trigger). */
export async function getProfile(user: AuthUser) {
  return db.profile.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email },
    update: {},
  });
}

/** Signed-in user, 18+ confirmed, and not on a self-imposed break. */
export async function requireAdult(authorization?: string | null) {
  const user = await requireUser(authorization);
  const profile = await getProfile(user);
  if (!profile.ageConfirmedAt) {
    throw new AppError("AGE_NOT_CONFIRMED", "Please confirm you are 18 or older to continue.");
  }
  if (profile.excludedUntil && profile.excludedUntil > new Date()) {
    throw new AppError("FORBIDDEN", `You're taking a break until ${profile.excludedUntil.toISOString().slice(0, 10)}. Support is on our responsible gambling page.`);
  }
  return { user, profile };
}
