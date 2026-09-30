import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-pages";
import { postSignInPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// Google OAuth (PKCE code exchange). Email sign-in uses /auth/confirm, which works across devices.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(await postSignInPath(next), origin));
    logger.warn("auth.callback_exchange_failed", { message: error.message, status: error.status });
  }
  return NextResponse.redirect(new URL(`/login?error=callback&next=${encodeURIComponent(next)}`, origin));
}
