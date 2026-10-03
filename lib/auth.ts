import "server-only";
import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { ProfileModel } from "@/lib/generated/prisma/models";
import type { UserRole } from "@/lib/generated/prisma/enums";

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

/**
 * Loads the profile, creating it if the auth trigger hasn't (e.g. users created before the trigger).
 *
 * Cached for the request, because the page guard and the page itself both want the profile, and so
 * does the account page a third time through getMe.
 *
 * One statement. Prisma's own upsert is a transaction - BEGIN, two SELECTs, COMMIT - which is four
 * round trips to a database in another region before any protected page can render. ON CONFLICT is
 * one. The conflict branch assigns the row to itself: there is nothing to update, and overwriting
 * the email from the token would undo a change made anywhere else.
 *
 * Be careful here. Replacing this with a plain findUnique is what the shape of the code invites,
 * and when that went out, new users could not get past the 18+ page on the live site at all: the
 * confirmation was written and the next request still saw an unconfirmed profile. Reverting to a
 * write fixed it. What was never pinned down is why - it does not reproduce against a local
 * production build, and Hyperdrive is not serving stale reads (checked on the live site: a
 * subscription written straight to the database shows up on the very next request). So the reason
 * this is a write is that reads here have been seen to be wrong in production, and nobody has
 * explained it. scripts/smoke-live.mjs is the check that caught it; run it before trusting a change
 * to this function.
 */
export const getProfile = cache(async (user: AuthUser) => {
  const [row] = await db.$queryRaw<ProfileRow[]>`
    insert into profiles (id, email) values (${user.id}::uuid, ${user.email})
    on conflict (id) do update set id = profiles.id
    returning *
  `;
  return fromRow(row);
});

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  age_confirmed_at: Date | null;
  free_ai_credits: number;
  telegram_chat_id: string | null;
  referral_code: string | null;
  referred_by_id: string | null;
  spend_note_pesewas: number | null;
  reminders_on: boolean;
  excluded_until: Date | null;
  created_at: Date;
  updated_at: Date;
};

function fromRow(row: ProfileRow): ProfileModel {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    ageConfirmedAt: row.age_confirmed_at,
    freeAiCredits: row.free_ai_credits,
    telegramChatId: row.telegram_chat_id,
    referralCode: row.referral_code,
    referredById: row.referred_by_id,
    spendNotePesewas: row.spend_note_pesewas,
    remindersOn: row.reminders_on,
    excludedUntil: row.excluded_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
