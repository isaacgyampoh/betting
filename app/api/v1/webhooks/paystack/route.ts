import { NextResponse, type NextRequest } from "next/server";
import { isValidSignature, paymentsConfigured, type PaystackTransaction } from "@/lib/billing/paystack";
import { logger } from "@/lib/logger";
import { fulfilTransaction } from "@/lib/services/billing";

// Paystack retries until it gets a 200, so only return non-200 when a retry could help.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Without the key there is nothing to verify a signature against, and an unverified payment
  // event must never be acted on. 503 rather than 200: Paystack keeps retrying, so an event that
  // arrives while the key is missing is still fulfilled once it is set, instead of being
  // acknowledged and silently dropped. Checked first because the signature check itself needs the
  // key and would otherwise throw, which reaches the caller as a bare 500.
  if (!paymentsConfigured()) {
    logger.error("paystack.not_configured", { reason: "PAYSTACK_SECRET_KEY is not set" });
    return NextResponse.json({ error: "payments are not configured" }, { status: 503 });
  }

  if (!isValidSignature(raw, req.headers.get("x-paystack-signature"))) {
    logger.warn("paystack.bad_signature", { ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: { event: string; data: PaystackTransaction };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (event.event === "charge.success") {
    try {
      const result = await fulfilTransaction(event.data);
      logger.info("paystack.webhook_processed", { reference: event.data.reference, result: result.status });
    } catch (err) {
      logger.error("paystack.webhook_failed", { reference: event.data?.reference, err });
      return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Paystack will retry
    }
  } else {
    logger.info("paystack.webhook_ignored", { event: event.event });
  }
  return NextResponse.json({ received: true });
}
