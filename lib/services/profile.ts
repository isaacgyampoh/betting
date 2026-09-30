import "server-only";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { getProfile } from "@/lib/auth";

export async function getActiveSubscription(userId: string) {
  return db.subscription.findFirst({
    where: { userId, status: "ACTIVE", endsAt: { gt: new Date() } },
    include: { plan: true },
    orderBy: { endsAt: "desc" },
  });
}

/** Public shape of the current user, shared by the web app, Telegram bot and mobile app. */
export async function getMe(user: AuthUser) {
  const [profile, subscription] = await Promise.all([getProfile(user), getActiveSubscription(user.id)]);
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    ageConfirmed: profile.ageConfirmedAt !== null,
    freeAiCredits: profile.freeAiCredits,
    subscription: subscription && {
      plan: subscription.plan.code,
      planName: subscription.plan.name,
      endsAt: subscription.endsAt,
    },
  };
}

export type Me = Awaited<ReturnType<typeof getMe>>;

export async function confirmAge(user: AuthUser) {
  await getProfile(user);
  // Keep the first confirmation timestamp.
  await db.profile.updateMany({
    where: { id: user.id, ageConfirmedAt: null },
    data: { ageConfirmedAt: new Date() },
  });
}
