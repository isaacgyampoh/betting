import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "@/lib/auth";
import { initializeTransaction, verifyTransaction, type PaystackTransaction } from "@/lib/billing/paystack";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";

const DAY_MS = 86_400_000;

/** Starts a Paystack checkout for a plan. Returns the URL to send the user to. */
export async function startCheckout(user: AuthUser, planCode: string): Promise<{ authorizationUrl: string; reference: string }> {
  const plan = await db.plan.findUnique({ where: { code: planCode } });
  if (!plan || !plan.isActive) throw new AppError("BAD_REQUEST", "That plan isn't available.");
  const profile = await db.profile.findUnique({ where: { id: user.id }, select: { email: true } });
  const email = profile?.email ?? user.email;
  if (!email) throw new AppError("BAD_REQUEST", "Add an email address to your account to pay.");

  const reference = `gc_${randomUUID().replaceAll("-", "")}`;
  await db.payment.create({
    data: { userId: user.id, planId: plan.id, reference, amountPesewas: plan.pricePesewas, currency: plan.currency, status: "PENDING" },
  });

  const tx = await initializeTransaction({
    email,
    amountPesewas: plan.pricePesewas,
    reference,
    callbackUrl: `${env().NEXT_PUBLIC_SITE_URL}/billing/callback`,
    metadata: { userId: user.id, plan: plan.code },
  });
  logger.info("billing.checkout_started", { userId: user.id, plan: plan.code, reference });
  return { authorizationUrl: tx.authorization_url, reference };
}

export type FulfilResult = { status: "activated" | "already_processed" | "failed" | "pending"; endsAt?: Date; plan?: string };

/**
 * Applies a Paystack transaction to our records. Idempotent: the webhook and the redirect
 * callback may both call it, in any order, any number of times.
 */
export async function fulfilTransaction(tx: PaystackTransaction): Promise<FulfilResult> {
  const payment = await db.payment.findUnique({ where: { reference: tx.reference }, include: { plan: true } });
  if (!payment) {
    logger.warn("billing.unknown_reference", { reference: tx.reference });
    return { status: "failed" };
  }
  if (payment.status === "SUCCESS") return { status: "already_processed", plan: payment.plan.code };

  if (tx.status !== "success") {
    const terminal = tx.status === "failed" || tx.status === "abandoned" || tx.status === "reversed";
    if (terminal) {
      await db.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: tx.status === "abandoned" ? "ABANDONED" : "FAILED", raw: tx as unknown as Prisma.InputJsonValue },
      });
    }
    return { status: terminal ? "failed" : "pending" };
  }

  // Never trust the client: amount and currency must match what we asked for.
  if (tx.amount !== payment.amountPesewas || tx.currency !== payment.currency) {
    logger.error("billing.amount_mismatch", { reference: tx.reference, expected: payment.amountPesewas, got: tx.amount, currency: tx.currency });
    await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", raw: tx as unknown as Prisma.InputJsonValue } });
    return { status: "failed" };
  }

  return db.$transaction(async (trx) => {
    // The status guard makes concurrent webhook + callback safe: only one update wins.
    const claimed = await trx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "SUCCESS",
        channel: tx.channel,
        paidAt: tx.paid_at ? new Date(tx.paid_at) : new Date(),
        raw: tx as unknown as Prisma.InputJsonValue,
      },
    });
    if (claimed.count === 0) return { status: "already_processed" as const, plan: payment.plan.code };

    // Time stacks: a new pass starts when the current one ends.
    const now = new Date();
    const current = await trx.subscription.findFirst({
      where: { userId: payment.userId, status: "ACTIVE", endsAt: { gt: now } },
      orderBy: { endsAt: "desc" },
    });
    const startsAt = current?.endsAt && current.endsAt > now ? current.endsAt : now;
    const endsAt = new Date(startsAt.getTime() + payment.plan.durationDays * DAY_MS);
    const subscription = await trx.subscription.create({
      data: { userId: payment.userId, planId: payment.planId, status: "ACTIVE", startsAt: now, endsAt },
    });
    await trx.payment.update({ where: { id: payment.id }, data: { subscriptionId: subscription.id } });
    logger.info("billing.activated", { userId: payment.userId, plan: payment.plan.code, endsAt, reference: tx.reference });
    return { status: "activated" as const, endsAt, plan: payment.plan.code };
  });
}

/** Redirect callback: verify with Paystack (the query string alone proves nothing), then fulfil. */
export async function verifyAndFulfil(user: AuthUser, reference: string): Promise<FulfilResult> {
  const payment = await db.payment.findUnique({ where: { reference } });
  if (!payment || payment.userId !== user.id) throw new AppError("NOT_FOUND", "Payment not found.");
  return fulfilTransaction(await verifyTransaction(reference));
}

export async function listPayments(user: AuthUser) {
  const rows = await db.payment.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { plan: { select: { name: true } } },
  });
  return rows.map((p) => ({
    reference: p.reference,
    plan: p.plan.name,
    amountGhs: p.amountPesewas / 100,
    status: p.status,
    channel: p.channel,
    createdAt: p.createdAt.toISOString(),
  }));
}
