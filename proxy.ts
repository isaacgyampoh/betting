import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Pages that need a signed-in user. Redirecting here (not only in the page) gives a real 307
// before any streaming starts. Pages still check age confirmation themselves.
const PROTECTED_PREFIXES = ["/slip", "/convert", "/matches", "/chat", "/account", "/welcome", "/billing"];

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!userId && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static assets, the service worker, PWA files and API routes (they authenticate themselves).
    "/((?!api|_next/static|_next/image|sw.js|manifest.webmanifest|icons/|favicon.ico|icon|apple-icon|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
