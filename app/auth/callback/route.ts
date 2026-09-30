import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser, getProfile } from "@/lib/auth";
import { safeNext } from "@/lib/auth-pages";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// Landing point for magic links and Google OAuth (PKCE code exchange).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      try {
        const user = await getAuthUser();
        const profile = user ? await getProfile(user) : null;
        const dest = profile?.ageConfirmedAt ? next : `/welcome?next=${encodeURIComponent(next)}`;
        return NextResponse.redirect(new URL(dest, origin));
      } catch (err) {
        // Signed in with Supabase, but our database is unavailable: explain instead of a 500.
        logger.error("auth.callback_profile_failed", { err });
        return NextResponse.redirect(new URL(`/login?error=unavailable&next=${encodeURIComponent(next)}`, origin));
      }
    }
    logger.warn("auth.callback_exchange_failed", { message: error.message, status: error.status });
  }

  return NextResponse.redirect(new URL(`/login?error=callback&next=${encodeURIComponent(next)}`, origin));
}
