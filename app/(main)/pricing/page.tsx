import type { Metadata } from "next";
import { Check } from "lucide-react";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { listActivePlans } from "@/lib/services/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Slip tools are free. AI assistant and deep match analysis from GHS 5 a day. Pay with mobile money or card.",
  alternates: { canonical: "/pricing" },
};

// Prices live in the database; render per request so builds never need a DB connection.
export const dynamic = "force-dynamic";

const ghs = (n: number) => `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: n % 1 ? 2 : 0 })}`;

export default async function PricingPage() {
  const [plans, user] = await Promise.all([
    listActivePlans().catch((err) => {
      logger.error("pricing.plans_unavailable", { err });
      return null;
    }),
    getAuthUser().catch(() => null),
  ]);
  const bestValue = plans?.at(-1)?.code;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Loading, converting and editing slips is always free. Plans unlock the AI assistant. Pay with MTN MoMo, Telecel Cash, AirtelTigo Money or card. No auto-renewal.
        </p>
      </div>

      {!plans?.length && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Plans are temporarily unavailable. Please check back shortly. Slip tools remain free.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {plans?.map((p) => (
          <Card key={p.code} className={cn(p.code === bestValue && "border-primary")}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {p.name}
                {p.code === bestValue && <Badge>Best value</Badge>}
              </CardTitle>
              <CardDescription>
                <span className="text-2xl font-bold text-foreground">{ghs(p.priceGhs)}</span> / {p.durationDays === 1 ? "day" : `${p.durationDays} days`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-primary" /> {p.dailyAiRequests} AI requests a day</li>
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-primary" /> Convert, split and trim slips by chat</li>
                <li className={cn("flex gap-2", !p.allowDeepAnalysis && "text-muted-foreground line-through")}>
                  <Check className="size-4 shrink-0 text-primary" /> Deep AI match analysis
                </li>
              </ul>
              <CheckoutButton plan={p.code} label={`Get ${p.name}`} signedIn={!!user} highlight={p.code === bestValue} />
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Buying again adds time on top of your current plan. Payments are processed by Paystack; we never see your card or MoMo PIN. AI analysis describes stats and is not a guarantee.
      </p>
    </div>
  );
}
