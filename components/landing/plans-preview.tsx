import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanView } from "@/lib/services/plans";
import { cn } from "@/lib/utils";

/**
 * What it costs, on the front page.
 *
 * Someone deciding whether to try this wants the price before they go looking for it, and a link
 * to a pricing page is a decision they have to make twice. Everything here is read from the plans
 * table - the same rows the pricing page and the limits use - so it cannot drift from what is
 * actually charged or actually allowed.
 */

/** One plan per tier, the shortest period of each, so the row reads as a ladder rather than a list. */
function pickTiers(plans: PlanView[]): PlanView[] {
  const byTier = new Map<string, PlanView>();
  for (const p of plans.filter((x) => x.priceGhs > 0).sort((a, b) => a.durationDays - b.durationDays)) {
    if (!byTier.has(p.tier)) byTier.set(p.tier, p);
  }
  return [...byTier.values()].sort((a, b) => a.priceGhs - b.priceGhs).slice(0, 3);
}

const per = (p: PlanView) => (p.durationDays === 1 ? "a day" : p.durationDays === 7 ? "a week" : `${p.durationDays} days`);

/**
 * Only limits the plan really carries. -1 means unlimited in the plans table.
 *
 * Limits are daily whatever the plan's length, so a weekly plan has to say "a day" on each line.
 * A daily plan has already said it in the price, and repeating it reads like a form.
 */
function lines(p: PlanView): string[] {
  const daily = p.durationDays === 1 ? "" : " a day";
  const count = (n: number, one: string, many: string) => (n < 0 ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many}${daily}`);
  const out = [count(p.dailyAiRequests, "chat message", "chat messages"), count(p.dailySlipBuilds, "slip build", "slip builds")];
  if (p.dailyUploads > 0) out.push(count(p.dailyUploads, "screenshot read", "screenshot reads"));
  if (p.allowDailyPicks) out.push("The daily 2 and 5 odds picks");
  if (p.allowDeepAnalysis) out.push("Match analysis");
  return out;
}

export function PlansPreview({ plans }: { plans: PlanView[] }) {
  const tiers = pickTiers(plans);
  if (!tiers.length) return null;
  const best = tiers[Math.min(1, tiers.length - 1)];

  return (
    <section aria-labelledby="plans" className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">What it costs</p>
        <h2 id="plans" className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
          Reading and converting codes is free.
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          You only pay for the asking: chat, slips built from today&apos;s prices, screenshot reads and the daily picks.
          Mobile money or card. Nothing renews on its own.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {tiers.map((p) => (
          <div
            key={p.code}
            className={cn(
              "flex flex-col rounded-lg border bg-card p-5",
              p.code === best.code && "border-primary ring-1 ring-primary/20",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">{p.name}</p>
              {p.code === best.code && <span className="text-[11px] font-medium text-primary">Most picked</span>}
            </div>
            <p className="mt-2">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">GHS {p.priceGhs}</span>
              <span className="text-sm text-muted-foreground"> {per(p)}</span>
            </p>
            <ul className="mt-4 flex-1 space-y-1.5">
              {lines(p).map((l) => (
                <li key={l} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-win" aria-hidden />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg" className="h-12 px-6">
          <Link href="/pricing">
            See all plans <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Or open the app and paste a code — that part costs nothing.</p>
      </div>
    </section>
  );
}
