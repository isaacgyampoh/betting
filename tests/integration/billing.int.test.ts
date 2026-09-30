import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isValidSignature } from "@/lib/billing/paystack";
import { fulfilTransaction, startCheckout, verifyAndFulfil } from "@/lib/services/billing";
import { getAiAllowance } from "@/lib/services/ai-quota";
import { createUser } from "./helpers";

const SECRET = "sk_test_integration";

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
});
afterEach(() => vi.unstubAllGlobals());

function paystackOk(data: unknown) {
  return new Response(JSON.stringify({ status: true, message: "ok", data }), { status: 200 });
}

async function checkout(plan = "weekly") {
  const user = await createUser();
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return paystackOk({ authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: "x", reference: body.reference });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { reference, authorizationUrl } = await startCheckout(user, plan);
  return { user, reference, authorizationUrl, sent: JSON.parse(fetchMock.mock.calls[0][1].body as string) };
}

const tx = (reference: string, amount: number, status = "success") => ({
  id: 1, reference, status, amount, currency: "GHS", channel: "mobile_money", paid_at: new Date().toISOString(), customer: { email: "a@b.c" }, metadata: {},
}) as Parameters<typeof fulfilTransaction>[0];

describe("Paystack billing", () => {
  it("starts checkout with the DB price in pesewas, GHS, MoMo + card", async () => {
    const { sent, authorizationUrl, reference } = await checkout("weekly");
    const plan = await db.plan.findUniqueOrThrow({ where: { code: "weekly" } });
    expect(sent).toMatchObject({ amount: plan.pricePesewas, currency: "GHS", channels: ["mobile_money", "card"], reference });
    expect(authorizationUrl).toContain(reference);
    expect(await db.payment.findUnique({ where: { reference } })).toMatchObject({ status: "PENDING" });
  });

  it("activates the plan once, however many times the webhook/callback fire", async () => {
    const { user, reference } = await checkout("weekly");
    const amount = (await db.payment.findUniqueOrThrow({ where: { reference } })).amountPesewas;
    const results = await Promise.all([fulfilTransaction(tx(reference, amount)), fulfilTransaction(tx(reference, amount)), fulfilTransaction(tx(reference, amount))]);
    expect(results.filter((r) => r.status === "activated")).toHaveLength(1);
    expect(await db.subscription.count({ where: { userId: user.id } })).toBe(1);
    const allowance = await getAiAllowance(user.id);
    expect(allowance).toMatchObject({ kind: "plan", allowDeepAnalysis: true, plan: { code: "weekly" } });
  });

  it("stacks time when buying again", async () => {
    const first = await checkout("daily");
    const amount = (await db.payment.findUniqueOrThrow({ where: { reference: first.reference } })).amountPesewas;
    const a = await fulfilTransaction(tx(first.reference, amount));
    const secondRef = (await startCheckout(first.user, "daily")).reference;
    const b = await fulfilTransaction(tx(secondRef, amount));
    expect(b.endsAt!.getTime() - a.endsAt!.getTime()).toBe(86_400_000);
  });

  it("rejects an amount mismatch and unpaid transactions", async () => {
    const { user, reference } = await checkout("monthly");
    expect(await fulfilTransaction(tx(reference, 100))).toEqual({ status: "failed" });
    expect(await db.subscription.count({ where: { userId: user.id } })).toBe(0);

    const second = await checkout("monthly");
    expect(await fulfilTransaction(tx(second.reference, 8000, "abandoned"))).toEqual({ status: "failed" });
    expect(await db.payment.findUnique({ where: { reference: second.reference } })).toMatchObject({ status: "ABANDONED" });
  });

  it("verifies the callback with Paystack and only for the payment's owner", async () => {
    const { user, reference } = await checkout("daily");
    const amount = (await db.payment.findUniqueOrThrow({ where: { reference } })).amountPesewas;
    vi.stubGlobal("fetch", vi.fn(async () => paystackOk(tx(reference, amount))));
    await expect(verifyAndFulfil(await createUser(), reference)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await verifyAndFulfil(user, reference)).toMatchObject({ status: "activated" });
  });

  it("webhook: rejects bad signatures, processes charge.success", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/paystack/route");
    const { user, reference } = await checkout("weekly");
    const amount = (await db.payment.findUniqueOrThrow({ where: { reference } })).amountPesewas;
    const body = JSON.stringify({ event: "charge.success", data: tx(reference, amount) });
    const sign = (b: string) => createHmac("sha512", SECRET).update(b).digest("hex");
    const req = (sig: string) => new NextRequest("http://localhost/api/v1/webhooks/paystack", { method: "POST", body, headers: { "x-paystack-signature": sig } });

    expect((await POST(req("00".repeat(64)))).status).toBe(401);
    expect(isValidSignature(body, sign(body), SECRET)).toBe(true);
    expect((await POST(req(sign(body)))).status).toBe(200);
    expect(await db.subscription.count({ where: { userId: user.id, status: "ACTIVE" } })).toBe(1);
  });
});
