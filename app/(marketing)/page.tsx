import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, CalendarCheck, Camera, LineChart, Scissors, Share2, Sparkles, Split } from "lucide-react";
import { Bookmakers } from "@/components/landing/bookmakers";
import { Faq } from "@/components/landing/faq";
import { PlansPreview } from "@/components/landing/plans-preview";
import { TrackRecordSummary } from "@/components/landing/track-record-summary";
import { HowItWorks } from "@/components/landing/how-it-works";
import { InstallGuide } from "@/components/landing/install-guide";
import { ProblemFix } from "@/components/landing/problem-fix";
import { PhoneDemo } from "@/components/landing/phone-demo";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { connectedBookmakers } from "@/lib/bookmakers/registry";
import { getTrackRecord } from "@/lib/services/daily-picks";
import { listActivePlans } from "@/lib/services/plans";

export const metadata: Metadata = {
  title: { absolute: "gameclaw: convert booking codes between Ghana's bookmakers" },
  description:
    "Paste a booking code to see every game, market and price on it. Move it to another bookmaker, or ask for a 2 or 5 odds built from today's real prices. Built in Ghana. 18+.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

// Shows live track record numbers, so it is rendered per request.
export const dynamic = "force-dynamic";

// Each line must describe something the app does today, and name the bookmakers it really works
// with. Do not write "every bookmaker" until every bookmaker is actually connected.
const FEATURES = [
  { icon: ArrowLeftRight, title: "Convert your code", text: "Move a code between the bookmakers we're connected to, in one message." },
  { icon: Sparkles, title: "Ask for a slip", text: "\"Build me a 5 odds\" — from today's real prices, across varied markets." },
  { icon: Scissors, title: "Cut it down", text: "Trim to the odds you want, or keep only the safest picks." },
  { icon: Camera, title: "Send a screenshot", text: "A picture of a slip from anywhere becomes games you can book." },
  { icon: LineChart, title: "Check it running", text: "Ask how your ticket is doing and get every leg back with live scores." },
  { icon: CalendarCheck, title: "Read the form first", text: "Recent results, home and away splits and head-to-head for any game." },
  { icon: Share2, title: "Share the slip", text: "One image with the code, the games and the reason each one is on there." },
  { icon: Split, title: "Split a long ticket", text: "Break twenty games into two or three slips instead of one all-or-nothing." },
];

export default async function HomePage() {
  const [record, plans] = await Promise.all([
    getTrackRecord(12).catch((err) => {
      logger.warn("landing.track_record_unavailable", { err });
      return null;
    }),
    listActivePlans().catch(() => null),
  ]);

  const cheapest = plans?.filter((p) => p.priceGhs > 0).sort((a, b) => a.priceGhs - b.priceGhs)[0];

  return (
    <div className="space-y-14 pb-4">
      {/* Decoration only: both are aria-hidden and pointer-events: none, and the page reads the
          same with them gone. */}
      <section className="gc-grid relative isolate grid items-center gap-8 pt-4 lg:grid-cols-2 lg:pt-10">
        <div className="gc-aurora" aria-hidden />
        <div className="space-y-5 text-center lg:text-left">
          <h1 className="text-[2.75rem] leading-[1.03] font-semibold tracking-[-0.03em] text-balance sm:text-6xl">
            Paste your code.
            <br />
            <span className="text-primary">Get a better slip.</span>
          </h1>
          <p className="mx-auto max-w-md text-balance text-muted-foreground lg:mx-0">
            See every game and price on your booking code, move it to another bookmaker, or ask for a 2 or 5 odds built
            from today&apos;s real prices.
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
          <p className="text-xs text-muted-foreground">
            Free to paste and view. Every pick we publish stays on the{" "}
            <Link href="/track-record" className="underline underline-offset-2 hover:text-foreground">
              public record
            </Link>
            , won or lost. 18+.
          </p>
        </div>
        <PhoneDemo />
      </section>

      <section aria-labelledby="features" className="gc-reveal gc-surface relative -mx-4 rounded-2xl px-4 py-8 sm:px-6">
        <h2 id="features" className="sr-only">
          What it does
        </h2>
        {/* Two up on a phone: eight of these stacked is most of a screen each, and the section after
            this one is the one that does the selling. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-card p-4 sm:p-6">
              <Icon className="mb-2.5 size-5 text-primary sm:mb-3" strokeWidth={1.75} />
              <p className="text-sm font-medium sm:text-base">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="gc-reveal">
        <ProblemFix />
      </div>

      <div className="gc-reveal gc-pitch relative isolate py-2">
        <HowItWorks />
      </div>

      <div className="gc-reveal">
        <Bookmakers />
      </div>

      <TrackRecordSummary record={record} />

      {plans?.length ? (
        <div className="gc-reveal">
          <PlansPreview plans={plans} />
        </div>
      ) : null}

      <div className="gc-reveal">
        <Faq connected={connectedBookmakers().filter((b) => b.capabilities.loadCode).map((b) => b.name)} />
      </div>

      <section aria-labelledby="install" className="gc-reveal grid gap-4 sm:grid-cols-2">
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

      <section className="gc-reveal gc-raised relative isolate overflow-hidden rounded-2xl border bg-card p-8 text-center">
        <div className="gc-aurora" aria-hidden />
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
