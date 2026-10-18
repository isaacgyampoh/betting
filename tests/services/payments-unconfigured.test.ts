import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A deployment with no payment key is a configuration state, not a fault.
 *
 * It was behaving as a fault: `requireEnv("PAYSTACK_SECRET_KEY")` threw, and both the checkout
 * route and the Paystack webhook answered 500 with an empty body - verified against the deployed
 * API, where an invalid-signature probe returned 500 rather than the 401 the code intends. A 500
 * says "we broke"; the truth was "payments were never set up here", which the caller can neither
 * fix nor retry into working.
 *
 * The webhook case is the one that matters. Paystack retries until it gets a 200, so the status
 * returned while the key is missing decides whether a real payment is eventually fulfilled or
 * quietly lost. It must not be 200.
 */

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.resetModules();
});

async function paystack() {
  vi.resetModules();
  return import("@/lib/billing/paystack");
}

describe("knowing whether payments are configured", () => {
  it("is false when the key is absent", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect((await paystack()).paymentsConfigured()).toBe(false);
  });

  it("is false when the key is only whitespace", async () => {
    // An env var set to a blank string in a dashboard is the same as unset, and reads as present
    // to a naive check.
    vi.stubEnv("PAYSTACK_SECRET_KEY", "   ");
    expect((await paystack()).paymentsConfigured()).toBe(false);
  });

  it("is true once a key is set", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_not_a_real_key");
    expect((await paystack()).paymentsConfigured()).toBe(true);
  });

  it("answers without throwing, which is the whole point", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const { paymentsConfigured } = await paystack();
    expect(() => paymentsConfigured()).not.toThrow();
  });
});

describe("the error a caller gets", () => {
  it("is a 503 that distinguishes 'not set up' from 'we broke'", async () => {
    const { AppError } = await import("@/lib/errors");
    const err = new AppError("PAYMENTS_UNAVAILABLE", "Payments aren't set up yet.");
    expect(err.status).toBe(503);
  });

  it("is not a 500, so a client does not report it as a crash", async () => {
    const { ERROR_CODES } = await import("@/lib/errors");
    expect(ERROR_CODES.PAYMENTS_UNAVAILABLE).not.toBe(500);
  });

  it("sits with the other 'configured elsewhere, not here' codes", async () => {
    const { ERROR_CODES } = await import("@/lib/errors");
    expect(ERROR_CODES.PAYMENTS_UNAVAILABLE).toBe(ERROR_CODES.AI_UNAVAILABLE);
  });
});

describe("starting a checkout without a payment key", () => {
  /** A real, active, paid plan - so nothing but the missing key can be what refuses it. */
  const paidPlan = { id: "plan-1", code: "monthly", isActive: true, pricePesewas: 2000, currency: "GHS" };
  const user = { id: "00000000-0000-0000-0000-000000000001", email: "someone@example.com" };

  it("refuses without writing a payment row it could never charge", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");

    // The row is the thing that must not exist: it is a promise to collect money from a
    // deployment with no way to collect it.
    const create = vi.fn();
    vi.doMock("@/lib/db", () => ({
      db: {
        plan: { findUnique: vi.fn().mockResolvedValue(paidPlan) },
        payment: { create },
        profile: { findUnique: vi.fn().mockResolvedValue({ email: "someone@example.com" }) },
      },
    }));

    const { startCheckout } = await import("@/lib/services/billing");
    await expect(startCheckout(user as never, "monthly")).rejects.toMatchObject({
      code: "PAYMENTS_UNAVAILABLE",
      status: 503,
    });

    expect(create).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/db");
  });

  it("still says a free plan is free, rather than blaming the missing key", async () => {
    // Ordering, and the reason it is not arbitrary. Whether a plan is free is permanent; whether
    // payments are configured is a property of this deployment. Answering the second first tells
    // somebody who asked for the free tier that they could buy it once payments work.
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");

    vi.doMock("@/lib/db", () => ({
      db: {
        plan: {
          findUnique: vi.fn().mockResolvedValue({ ...paidPlan, code: "free", pricePesewas: 0 }),
        },
        payment: { create: vi.fn() },
        profile: { findUnique: vi.fn() },
      },
    }));

    const { startCheckout } = await import("@/lib/services/billing");
    await expect(startCheckout(user as never, "free")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    vi.doUnmock("@/lib/db");
  });

  it("says a plan that does not exist does not exist, key or no key", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");

    vi.doMock("@/lib/db", () => ({
      db: {
        plan: { findUnique: vi.fn().mockResolvedValue(null) },
        payment: { create: vi.fn() },
        profile: { findUnique: vi.fn() },
      },
    }));

    const { startCheckout } = await import("@/lib/services/billing");
    await expect(startCheckout(user as never, "nonsense")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    vi.doUnmock("@/lib/db");
  });
});
