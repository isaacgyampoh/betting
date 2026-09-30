import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthUser } from "@/lib/auth";

// Referrals and the responsible-gambling tools.
//
// Self-exclusion is deliberately one-way: it can be extended but never shortened or cancelled,
// because a user in difficulty shouldn't be able to undo it in the moment.

export const REFERRAL_DAYS = 3;
const MAX_EXCLUSION_DAYS = 365;

function newReferralCode(): string {
  // Unambiguous characters only: no O/0 or I/1 confusion when typed from a message.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
}

/** The user's own code, created on first use. */
export async function getOrCreateReferralCode(user: AuthUser): Promise<string> {
  const existing = await db.profile.findUnique({ where: { id: user.id }, select: { referralCode: true } });
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    try {
      await db.profile.update({ where: { id: user.id }, data: { referralCode: code } });
      return code;
    } catch {
      /* collision: try another */
    }
  }
  throw new AppError("INTERNAL", "Couldn't create a referral code. Please try again.");
}

export type ReferralSummary = { code: string; joined: number; daysEarned: number };

export async function getReferralSummary(user: AuthUser): Promise<ReferralSummary> {
  const [code, joined, rewards] = await Promise.all([
    getOrCreateReferralCode(user),
    db.profile.count({ where: { referredById: user.id } }),
    db.referralReward.aggregate({ where: { userId: user.id }, _sum: { days: true } }),
  ]);
  return { code, joined, daysEarned: rewards._sum.days ?? 0 };
}

/**
 * Records that a new user came from someone's code and grants free days to both.
 * Ignored if the user was already referred, referred themselves, or the code is unknown.
 */
export async function applyReferral(newUser: AuthUser, code: string): Promise<{ applied: boolean }> {
  const profile = await db.profile.findUnique({ where: { id: newUser.id }, select: { referredById: true, createdAt: true } });
  if (!profile || profile.referredById) return { applied: false };

  const referrer = await db.profile.findUnique({ where: { referralCode: code.trim().toUpperCase() }, select: { id: true } });
  if (!referrer || referrer.id === newUser.id) return { applied: false };

  await db.profile.update({ where: { id: newUser.id }, data: { referredById: referrer.id } });
  await db.referralReward.createMany({
    data: [
      { userId: referrer.id, referredUserId: newUser.id, days: REFERRAL_DAYS },
      { userId: newUser.id, referredUserId: newUser.id, days: REFERRAL_DAYS },
    ],
    skipDuplicates: true,
  });
  logger.info("referral.applied", { referrerId: referrer.id, newUserId: newUser.id });
  return { applied: true };
}

export type ResponsibleSettings = { spendNoteGhs: number | null; remindersOn: boolean; excludedUntil: string | null };

export async function getResponsibleSettings(user: AuthUser): Promise<ResponsibleSettings> {
  const p = await db.profile.findUnique({
    where: { id: user.id },
    select: { spendNotePesewas: true, remindersOn: true, excludedUntil: true },
  });
  return {
    spendNoteGhs: p?.spendNotePesewas != null ? p.spendNotePesewas / 100 : null,
    remindersOn: p?.remindersOn ?? false,
    excludedUntil: p?.excludedUntil?.toISOString() ?? null,
  };
}

export async function updateResponsibleSettings(
  user: AuthUser,
  input: { spendNoteGhs?: number | null; remindersOn?: boolean; excludeDays?: number },
): Promise<ResponsibleSettings> {
  const current = await db.profile.findUnique({ where: { id: user.id }, select: { excludedUntil: true } });
  const data: { spendNotePesewas?: number | null; remindersOn?: boolean; excludedUntil?: Date } = {};

  if (input.spendNoteGhs !== undefined) {
    data.spendNotePesewas = input.spendNoteGhs === null ? null : Math.round(input.spendNoteGhs * 100);
  }
  if (input.remindersOn !== undefined) data.remindersOn = input.remindersOn;

  if (input.excludeDays !== undefined) {
    if (input.excludeDays < 1 || input.excludeDays > MAX_EXCLUSION_DAYS) {
      throw new AppError("BAD_REQUEST", `Choose between 1 and ${MAX_EXCLUSION_DAYS} days.`);
    }
    const until = new Date(Date.now() + input.excludeDays * 86_400_000);
    // One-way: an existing break can be extended, never cut short.
    if (current?.excludedUntil && current.excludedUntil > until) {
      throw new AppError("BAD_REQUEST", "Your break can't be shortened. It ends on the date already set.");
    }
    data.excludedUntil = until;
    logger.info("rg.self_excluded", { userId: user.id, until });
  }

  await db.profile.update({ where: { id: user.id }, data });
  return getResponsibleSettings(user);
}

/** Blocks betting features while a self-exclusion is active. */
export async function assertNotExcluded(userId: string): Promise<void> {
  const p = await db.profile.findUnique({ where: { id: userId }, select: { excludedUntil: true } });
  if (p?.excludedUntil && p.excludedUntil > new Date()) {
    throw new AppError("FORBIDDEN", `You're taking a break until ${p.excludedUntil.toISOString().slice(0, 10)}. Support: /responsible-gambling`);
  }
}
