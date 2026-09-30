import "server-only";
import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth";

/** Page guard: redirects to sign-in, then to the 18+ confirmation, before rendering. */
export async function requireAdultPage(next: string) {
  const user = await getAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const profile = await getProfile(user);
  if (!profile.ageConfirmedAt) redirect(`/welcome?next=${encodeURIComponent(next)}`);
  return { user, profile };
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | string[] | null | undefined, fallback = "/slip") {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
