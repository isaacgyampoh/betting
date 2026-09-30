import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { getAuthUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { listActivePlans, type PlanView } from "@/lib/services/plans";

export const metadata: Metadata = {
  title: "Plans",
  description: "Slip tools are free. Chat, slip building, screenshot reading and daily picks from GHS 10. Pay with mobile money or card.",
  alternates: { canonical: "/pricing" },
};

// Prices live in the database; render per request so builds never need a DB connection.
export const dynamic = "force-dynamic";

const ghs = (n: number) => `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const period = (days: number) => (days === 0 ? "always free" : days === 1 ? "for a day" : `for ${days} days`);
const limit = (n: number, one: string, many = `${one}s`) => (n < 0 ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many} a day`);

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex gap-2", !on && "text-muted-foreground")}>
      {on ? <Check className="size-4 shrink-0 text-muted-foreground" /> : <Minus className="size-4 shrink-0" />}
      <span>{children}</span>
    </li>
  );
}

function PlanCard({ plan, signedIn, featured }: { plan: PlanView; signedIn: boolean; featured: boolean }) {
  const free = plan.priceGhs === 0;
  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", featured && "ring-1 ring-primary")}>
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">{plan.name}</p>
          {featured && <span className="rounded border border-primary px-1.5 py-0.5 text-[11px] text-primary">Most popular</span>}
        </div>
        <p className="mt-1">
          <span className="text-2xl font-semibold">{free ? "Free" : ghs(plan.priceGhs)}</span>{" "}
          <span className="text-sm text-muted-foreground">{period(plan.durationDays)}</span>
        </p>
        {plan.description && <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>}
      </div>

      <ul className="flex-1 space-y-2 p-4 text-sm">
        <Feature on>{limit(plan.dailyAiRequests, "chat message")}</Feature>
        <Feature on={plan.dailyUploads !== 0}>
          {plan.dailyUploads === 0 ? "No screenshot reading" : limit(plan.dailyUploads, "screenshot read")}
        </Feature>
        <Feature on={plan.dailySlipBuilds !== 0}>
          {plan.dailySlipBuilds === 0 ? "No slip building" : limit(plan.dailySlipBuilds, "slip build")}
        </Feature>
        <Feature on={plan.allowDeepAnalysis}>
          {plan.allowDeepAnalysis ? limit(plan.dailyAnalyses, "match analysis", "match analyses") : "No match analysis"}
        </Feature>
        <Feature on={plan.allowDailyPicks}>{plan.allowDailyPicks ? "Daily 2 and 5 odds picks" : "Daily picks not included"}</Feature>
        <Feature on>Load, convert and trim slips (always free)</Feature>
      </ul>

      <div className="p-4 pt-0">
        {free ? (
          <p className="text-center text-xs text-muted-foreground">No sign-up needed beyond an account.</p>
        ) : (
          <CheckoutButton plan={plan.code} label={`Get ${plan.name}`} signedIn={signedIn} highlight={featured} />
        )}
      </div>
    </div>
  );
}

export default async function PricingPage() {
  const [plans, user] = await Promise.all([
    listActivePlans().catch((err) => {
      logger.error("pricing.plans_unavailable", { err });
      return null;
    }),
    getAuthUser().catch(() => null),
  ]);
  // The middle paid tier is the one to push.
  const paid = plans?.filter((p) => p.priceGhs > 0) ?? [];
  const featured = paid.length >= 2 ? paid[Math.floor((paid.length - 1) / 2)].code : paid[0]?.code;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Loading, converting and trimming slips is always free. Plans add chat, slip building, screenshot reading, analysis and the daily picks. Pay with
          MTN MoMo, Telecel Cash, AirtelTigo Money or card. No auto-renewal.
        </p>
      </div>

      {!plans?.length ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Plans are temporarily unavailable. Please check back shortly. Slip tools remain free.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => (
            <PlanCard key={p.code} plan={p} signedIn={!!user} featured={p.code === featured} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Limits reset at midnight (GMT). Buying again adds time on top of your current plan. Payments are processed by Paystack; we never see your card or
        MoMo PIN. Analysis and picks describe the numbers; they are not guarantees. 18+.
      </p>
    </div>
  );
}
