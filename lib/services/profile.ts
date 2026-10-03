import "server-only";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { getProfile } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { SubscriptionStatus, UserRole } from "@/lib/generated/prisma/enums";
import { planById, topVipPlan } from "@/lib/services/plans";

/**
 * Admins get the top tier without paying, so the operator can use and check every feature on the
 * live site. This is granted from the `role` column rather than a hard-coded address: the account
 * that holds it can change, and an email in source would be both fragile and public.
 *
 * The subscription returned for an admin is synthetic — nothing is written and no payment is
 * implied — and it applies even when the admin holds a real, lower plan. The grant is a floor, not
 * a fallback: an operator who once bought a cheap plan to test checkout must not be left on it.
 */
async function adminSubscription(userId: string, role: UserRole | undefined) {
  if (role !== "ADMIN") return null;

  const plan = await topVipPlan();
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

type SubscriptionRow = {
  role: UserRole;
  id: string | null;
  plan_id: string | null;
  status: SubscriptionStatus | null;
  starts_at: Date | null;
  ends_at: Date | null;
  paystack_subscription_code: string | null;
  created_at: Date | null;
  updated_at: Date | null;
};

/**
 * The signed-in user's plan, which every protected page waits on before it renders.
 *
 * One query. Asking Prisma for the profile with its subscription and that subscription's plan
 * reads well but is three separate SELECTs, and on Workers each one is a hop to another region.
 * The role and the subscription row are joined here, and the plan comes from the cached plans
 * table, because ten rows that change when someone edits pricing do not need re-reading per page.
 *
 * `knownRole` saves nothing now but is kept: callers holding the profile pass it, and it is what
 * makes the admin grant correct when the profile was read in the same request.
 */
export async function getActiveSubscription(userId: string, knownRole?: UserRole) {
  const [row] = await db.$queryRaw<SubscriptionRow[]>`
    select
      p.role,
      s.id, s.plan_id, s.status, s.starts_at, s.ends_at,
      s.paystack_subscription_code, s.created_at, s.updated_at
    from profiles p
    left join lateral (
      select * from subscriptions
      where user_id = p.id and status = 'ACTIVE' and ends_at > now()
      order by ends_at desc
      limit 1
    ) s on true
    where p.id = ${userId}::uuid
  `;

  // The admin grant is checked first and wins: VIP is the top tier, so it is never worse than
  // anything they hold, and falling back only when they have nothing would leave an admin with an
  // old test purchase stuck on it.
  const granted = await adminSubscription(userId, knownRole ?? row?.role);
  if (granted) return granted;

  if (!row?.id || !row.plan_id) return null;
  const plan = await planById(row.plan_id);
  if (!plan) {
    // A subscription pointing at a plan that no longer exists is not a plan; treat it as none
    // rather than guessing limits.
    logger.warn("profile.subscription_without_plan", { userId, planId: row.plan_id });
    return null;
  }
  return {
    id: row.id,
    userId,
    planId: row.plan_id,
    status: row.status ?? ("ACTIVE" as const),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    paystackSubscriptionCode: row.paystack_subscription_code,
    createdAt: row.created_at ?? new Date(),
    updatedAt: row.updated_at ?? new Date(),
    plan,
  };
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
