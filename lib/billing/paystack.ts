import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { requireEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

// Paystack REST API (https://paystack.com/docs/api/). Amounts are in the subunit (pesewas for GHS).
const BASE = "https://api.paystack.co";

export type PaystackTransaction = {
  id: number;
  reference: string;
  status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "processing" | "queued" | "reversed";
  amount: number;
  currency: string;
  channel: string | null;
  paid_at: string | null;
  customer: { email: string };
  metadata: unknown;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`, "content-type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (err) {
    logger.error("paystack.network_error", { path, err });
    throw new AppError("PAYMENT_FAILED", "Couldn't reach the payment provider. Please try again.", { cause: err });
  }
  const body = (await res.json().catch(() => null)) as { status: boolean; message: string; data: T } | null;
  if (!res.ok || !body?.status) {
    logger.error("paystack.api_error", { path, status: res.status, message: body?.message });
    throw new AppError("PAYMENT_FAILED", "The payment couldn't be started. Please try again.");
  }
  return body.data;
}

export function initializeTransaction(input: {
  email: string;
  amountPesewas: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}) {
  return call<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amountPesewas,
      currency: "GHS",
      reference: input.reference,
      callback_url: input.callbackUrl,
      channels: ["mobile_money", "card"],
      metadata: input.metadata,
    }),
  });
}

export function verifyTransaction(reference: string) {
  return call<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Webhook authenticity: HMAC-SHA512 of the raw body with the secret key, in x-paystack-signature. */
export function isValidSignature(rawBody: string, signature: string | null, secret = requireEnv("PAYSTACK_SECRET_KEY")): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
