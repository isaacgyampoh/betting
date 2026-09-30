import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth";

// One auth + profile lookup per request, shared by guard layouts and their pages.
const loadSession = cache(async () => {
  const user = await getAuthUser();
  if (!user) return null;
  return { user, profile: await getProfile(user) };
});

/**
 * Page guard: redirects to sign-in, then to the 18+ confirmation, before rendering.
 * Called from each protected section's layout (outside its loading.tsx, so a signed-out
 * visitor gets a real 307) and again from the page to get the user; the lookup is cached.
 */
export async function requireAdultPage(next: string) {
  const session = await loadSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!session.profile.ageConfirmedAt) redirect(`/welcome?next=${encodeURIComponent(next)}`);
  return session;
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | string[] | null | undefined, fallback = "/slip") {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
