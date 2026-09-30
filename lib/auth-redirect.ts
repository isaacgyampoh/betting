import "server-only";
import { getAuthUser, getProfile } from "@/lib/auth";
import { logger } from "@/lib/logger";

/** Where to send a user who just signed in: the 18+ step first if they haven't done it. */
export async function postSignInPath(next: string): Promise<string> {
  try {
    const user = await getAuthUser();
    const profile = user ? await getProfile(user) : null;
    return profile?.ageConfirmedAt ? next : `/welcome?next=${encodeURIComponent(next)}`;
  } catch (err) {
    // Signed in with Supabase, but our database is unavailable: explain instead of a 500.
    logger.error("auth.profile_unavailable", { err });
    return `/login?error=unavailable&next=${encodeURIComponent(next)}`;
  }
}
