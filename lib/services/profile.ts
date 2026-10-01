import "server-only";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { getProfile } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * Admins get the top tier without paying, so the operator can use and check every feature on the
 * live site. This is granted from the `role` column rather than a hard-coded address: the account
 * that holds it can change, and an email in source would be both fragile and public.
 *
 * The subscription returned for an admin is synthetic — nothing is written and no payment is
 * implied — and it applies even when the admin holds a real, lower plan. The grant is a floor, not
 * a fallback: an operator who once bought a cheap plan to test checkout must not be left on it.
 */
async function adminSubscription(userId: string, knownRole?: UserRole) {
  const role = knownRole ?? (await db.profile.findUnique({ where: { id: userId }, select: { role: true } }))?.role;
  if (role !== "ADMIN") return null;

  // Any VIP row carries the VIP limits; they differ only in price and duration.
  const plan = await db.plan.findFirst({ where: { code: { startsWith: "vip" }, isActive: true }, orderBy: { durationDays: "desc" } });
  if (!plan) {
    logger.warn("profile.admin_without_vip_plan", { userId });
    return null;
  }
  const now = new Date();
  return {
    id: `admin:${userId}`,
    userId,
    planId: plan.id,
    status: "ACTIVE" as const,
    startsAt: now,
    // Far enough out that it never lapses; this row is never persisted.
    endsAt: new Date("2099-01-01T00:00:00Z"),
    paystackSubscriptionCode: null,
    createdAt: now,
    updatedAt: now,
    plan,
  };
}

/** `knownRole` saves a query when the caller already holds the profile. */
export async function getActiveSubscription(userId: string, knownRole?: UserRole) {
  // The admin grant is checked first and wins: VIP is the top tier, so it is never worse than
  // anything they hold, and falling back only when they have nothing would leave an admin with an
  // old test purchase stuck on it.
  const granted = await adminSubscription(userId, knownRole);
  if (granted) return granted;
  return db.subscription.findFirst({
    where: { userId, status: "ACTIVE", endsAt: { gt: new Date() } },
    include: { plan: true },
    orderBy: { endsAt: "desc" },
  });
}

/** Public shape of the current user, shared by the web app, Telegram bot and mobile app. */
export async function getMe(user: AuthUser) {
  // Sequential on purpose: the subscription lookup needs the profile's role, and running both at
  // once on one pooled connection is what the pg adapter chokes on.
  const profile = await getProfile(user);
  const subscription = await getActiveSubscription(user.id, profile.role);
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
