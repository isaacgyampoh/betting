import type { Metadata } from "next";
import { PlanPicker } from "@/components/billing/plan-picker";
import { logger } from "@/lib/logger";
import { listActivePlans } from "@/lib/services/plans";

export const metadata: Metadata = {
  title: "Plans",
  description: "Slip tools are free. Chat, slip building, screenshot reading and daily picks from GHS 5 a day. Pay with mobile money or card.",
  alternates: { canonical: "/pricing" },
};

// Prices live in the database; render per request so builds never need a DB connection.
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await listActivePlans().catch((err) => {
    logger.error("pricing.plans_unavailable", { err });
    return null;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Loading, converting and trimming slips is always free. Plans add chat, slip building, screenshot reading, analysis and the daily picks, from GHS 5 a day. Pay with
          MTN MoMo, Telecel Cash, AirtelTigo Money or card. No auto-renewal.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Plans are bought inside the app.</p>
      </div>

      {!plans?.length ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Plans are temporarily unavailable. Please check back shortly. Slip tools remain free.
        </p>
      ) : (
        <PlanPicker plans={plans} signedIn={false} purchasable={false} />
      )}

      <p className="text-xs text-muted-foreground">
        Limits reset at midnight (GMT). Buying again adds time on top of your current plan. Payments are processed by Paystack; we never see your card or
        MoMo PIN. Analysis and picks describe the numbers; they are not guarantees. 18+.
      </p>
    </div>
  );
}
