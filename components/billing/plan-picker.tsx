"use client";

import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { cn } from "@/lib/utils";
import type { PlanPeriod, PlanView } from "@/lib/services/plans";

const PERIODS: { key: PlanPeriod; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const ghs = (n: number) => `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const perDay = (p: PlanView) => (p.durationDays > 1 ? `${ghs(Math.round((p.priceGhs / p.durationDays) * 100) / 100)} a day` : null);
const limit = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many} a day`;

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex gap-2", !on && "text-muted-foreground")}>
      {on ? <Check className="size-4 shrink-0 text-muted-foreground" /> : <Minus className="size-4 shrink-0" />}
      <span>{children}</span>
    </li>
  );
}

function Card({ plan, signedIn, featured }: { plan: PlanView; signedIn: boolean; featured: boolean }) {
  const free = plan.priceGhs === 0;
  const rate = perDay(plan);
  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", featured && "ring-1 ring-primary")}>
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">{plan.name}</p>
          {featured && <span className="rounded border border-primary px-1.5 py-0.5 text-[11px] text-primary">Most popular</span>}
        </div>
        <p className="mt-1 text-2xl font-semibold">{free ? "Free" : ghs(plan.priceGhs)}</p>
        <p className="text-xs text-muted-foreground">{free ? "always" : rate ? `${rate} · billed once` : "for a day"}</p>
      </div>

      <ul className="flex-1 space-y-2 p-4 text-sm">
        <Feature on>{limit(plan.dailyAiRequests, "chat message")}</Feature>
        <Feature on={plan.dailyUploads > 0}>{limit(plan.dailyUploads, "screenshot read")}</Feature>
        <Feature on={plan.dailySlipBuilds > 0}>{limit(plan.dailySlipBuilds, "slip build")}</Feature>
        <Feature on={plan.allowDeepAnalysis}>
          {plan.allowDeepAnalysis ? limit(plan.dailyAnalyses, "match analysis", "match analyses") : "No match analysis"}
        </Feature>
        <Feature on={plan.allowDailyPicks}>{plan.allowDailyPicks ? "Daily 2 and 5 odds picks" : "Daily picks not included"}</Feature>
        <Feature on>Load, convert and trim slips (always free)</Feature>
      </ul>

      <div className="p-4 pt-0">
        {free ? (
          <p className="text-center text-xs text-muted-foreground">What you get without paying.</p>
        ) : (
          <CheckoutButton plan={plan.code} label={`Get ${plan.name}`} signedIn={signedIn} highlight={featured} />
        )}
      </div>
    </div>
  );
}

/** Free alongside the three tiers, with a day/week/month switch for the paid ones. */
export function PlanPicker({ plans, signedIn }: { plans: PlanView[]; signedIn: boolean }) {
  const [period, setPeriod] = useState<PlanPeriod>("week");
  const free = plans.find((p) => p.tier === "free");
  const paid = plans.filter((p) => p.period === period).sort((a, b) => a.priceGhs - b.priceGhs);
  const available = PERIODS.filter((p) => plans.some((x) => x.period === p.key));

  return (
    <div className="space-y-4">
      {available.length > 1 && (
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-lg border bg-card p-1">
          {available.map((p) => (
            <button
              key={p.key}
              role="radio"
              aria-checked={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={cn("rounded-md px-4 py-1.5 text-sm font-medium", period === p.key ? "bg-secondary text-foreground" : "text-muted-foreground")}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {free && <Card plan={free} signedIn={signedIn} featured={false} />}
        {paid.map((p) => (
          <Card key={p.code} plan={p} signedIn={signedIn} featured={p.tier === "pro"} />
        ))}
      </div>
    </div>
  );
}
