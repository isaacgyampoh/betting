import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-pages";
import { postSignInPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

// Email sign-in links land here with a token_hash. Verified server-side, so the link works on any
// device or browser (e.g. requested on a laptop, opened in the Gmail app on a phone).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type && TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(await postSignInPath(next), origin));
    logger.warn("auth.confirm_failed", { type, message: error.message, status: error.status });
  }
  return NextResponse.redirect(new URL(`/login?error=expired&next=${encodeURIComponent(next)}`, origin));
}
