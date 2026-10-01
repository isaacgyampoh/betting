import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Scissors, Sparkles } from "lucide-react";
import { InstallGuide } from "@/components/landing/install-guide";
import { PhoneDemo } from "@/components/landing/phone-demo";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { getTrackRecord } from "@/lib/services/daily-picks";
import { listActivePlans } from "@/lib/services/plans";

export const metadata: Metadata = {
  title: { absolute: "gameclaw: convert booking codes between Ghana's bookmakers" },
  description:
    "Paste a SportyBet or MSport booking code to see every game, market and price on it. Convert it to the other, or ask for a 2 or 5 odds built from today's real prices. Built in Ghana. 18+.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

// Shows live track record numbers, so it is rendered per request.
export const dynamic = "force-dynamic";

// Each line must describe something the app does today, and name the bookmakers it really works
// with. Do not write "every bookmaker" until every bookmaker is actually connected.
const FEATURES = [
  { icon: ArrowLeftRight, title: "Convert your code", text: "Between SportyBet and MSport today, with more being connected." },
  { icon: Sparkles, title: "Ask for a slip", text: "\"Build me a 5 odds\" — from today's real prices, across varied markets." },
  { icon: Scissors, title: "Cut it down", text: "Trim to the odds you want, or keep only the safest picks." },
];

function Stat({ label, value, tone }: { label: string; value: string; tone?: "win" | "loss" }) {
  return (
    <div className="bg-card p-4 text-center">
      <p className={cn("text-2xl font-semibold", tone === "win" && "text-win", tone === "loss" && "text-loss")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function HomePage() {
  const [record, plans] = await Promise.all([
    getTrackRecord(12).catch((err) => {
      logger.warn("landing.track_record_unavailable", { err });
      return null;
    }),
    listActivePlans().catch(() => null),
  ]);

  const settled = record ? record.won + record.lost : 0;
  const cheapest = plans?.filter((p) => p.priceGhs > 0).sort((a, b) => a.priceGhs - b.priceGhs)[0];

  return (
    <div className="space-y-14 pb-4">
      <section className="grid items-center gap-8 pt-4 lg:grid-cols-2 lg:pt-10">
        <div className="space-y-5 text-center lg:text-left">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Paste your code. Get a better slip.
          </h1>
          <p className="mx-auto max-w-md text-balance text-muted-foreground lg:mx-0">
            See every game and price on your SportyBet or MSport code, convert it to the other, or ask for a 2 or 5 odds
            built from today&apos;s real prices.
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row lg:justify-start">
            <Button asChild size="lg" className="h-12 px-6">
              <Link href="/chat">
                Open app <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <Link href="/pricing">See plans</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Free to paste and view. 18+.</p>
        </div>
        <PhoneDemo />
      </section>

      <section aria-labelledby="features">
        <h2 id="features" className="sr-only">
          What it does
        </h2>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-card p-5">
              <Icon className="mb-3 size-5 text-muted-foreground" strokeWidth={1.75} />
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="record" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="record" className="text-lg font-semibold">
            Daily picks, in the open
          </h2>
          <Link href="/track-record" className="text-sm text-primary hover:underline">
            Full record
          </Link>
        </div>
        {settled > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
              <Stat label="Picks settled" value={String(settled)} />
              <Stat label="Win rate" value={record!.winRate === null ? "–" : `${record!.winRate}%`} />
              <Stat
                label="ROI, 1 unit a pick"
                value={record!.roi === null ? "–" : `${record!.roi}%`}
                tone={record!.roi !== null ? (record!.roi >= 0 ? "win" : "loss") : undefined}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Every pick we publish stays on the record, won or lost. Nothing is edited or removed.
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Daily picks start once the bookmakers are connected for live prices. Every pick will be published here with its
            result, win or lost, and nothing will be edited afterwards.
          </p>
        )}
      </section>

      <section aria-labelledby="install" className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <h2 id="install" className="text-lg font-semibold">
            Keep it on your phone
          </h2>
          <p className="text-sm text-muted-foreground">
            Works in the browser, or add it to your home screen and it opens full screen like an app. No store, no download.
          </p>
          {cheapest && (
            <p className="text-sm text-muted-foreground">
              Converting codes is free. Chat and the daily picks start at{" "}
              <Link href="/pricing" className="text-primary hover:underline">
                GHS {cheapest.priceGhs} a day
              </Link>
              .
            </p>
          )}
        </div>
        <InstallGuide />
      </section>

      <section className="rounded-lg border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold">Paste your first code</h2>
        <p className="mt-1 text-sm text-muted-foreground">It takes a few seconds and costs nothing.</p>
        <Button asChild size="lg" className="mt-4 h-12 px-6">
          <Link href="/chat">
            Open app <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </section>
    </div>
  );
}
