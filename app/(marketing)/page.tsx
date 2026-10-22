import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowLeftRight, BarChart3, Bell } from "lucide-react";
import { Faq } from "@/components/landing/faq";
import { GetTheApp } from "@/components/landing/get-the-app";
import { LiveNow } from "@/components/landing/live-now";
import { Screens } from "@/components/landing/screens";
import { TrackRecordSummary } from "@/components/landing/track-record-summary";
import { logger } from "@/lib/logger";
import { connectedBookmakers } from "@/lib/bookmakers/registry";
import { todaysScoreboard } from "@/lib/services/public-matches";
import { getTrackRecord } from "@/lib/services/daily-picks";
import { listActivePlans } from "@/lib/services/plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "GameClaw — live scores, form and stats for every match that matters" },
  description:
    "Live scores and minutes from the competitions people actually follow, form and head-to-head on every game, and notifications for your teams. Plus a tool that moves a booking code between bookmakers. Built in Ghana. 18+.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

// Shows today's real fixtures and live track record numbers, so it is rendered per request.
export const dynamic = "force-dynamic";

/**
 * What the app does, in the order it matters.
 *
 * Football comes first because football is what the app is for and what almost every session is
 * spent on. Conversion is a tool inside a football app, not the premise of the product - the old
 * version of this page led with it, which undersold four fifths of the thing and framed a stats
 * app as a betting utility.
 *
 * Each line has to be true of the build that is shipping. Where the honest answer is a limit, it
 * says so.
 */
const FEATURES = [
  {
    icon: Activity,
    title: "Every score, as it happens",
    text: "Goals and match minutes from the competitions people actually follow, grouped by league and refreshed while you watch.",
  },
  {
    icon: BarChart3,
    title: "The full picture on a game",
    text: "Open any match for recent form, home and away splits, and what happened the last time these two met.",
  },
  {
    icon: Bell,
    title: "Only your teams",
    text: "Follow a club and get a notification at kick-off, at every goal and at full time. Nothing else.",
  },
  {
    icon: ArrowLeftRight,
    title: "Move a slip across",
    text: "Paste a booking code to see every game and price on it, then rebuild it at another bookmaker. No money changes hands here.",
  },
];

export default async function HomePage() {
  const [board, record, plans] = await Promise.all([
    todaysScoreboard().catch((err) => {
      logger.warn("landing.scoreboard_unavailable", { err });
      return null;
    }),
    getTrackRecord(12).catch((err) => {
      logger.warn("landing.track_record_unavailable", { err });
      return null;
    }),
    listActivePlans().catch(() => null),
  ]);

  const cheapest = plans?.filter((p) => p.priceGhs > 0).sort((a, b) => a.priceGhs - b.priceGhs)[0];

  return (
    <div className="space-y-16 pb-4 sm:space-y-24">
      {/* Decoration only: aria-hidden and pointer-events: none, and the page reads the same with
          both gone. */}
      <section
        className={cn(
          "gc-grid relative isolate grid items-center gap-10 overflow-hidden pt-6 lg:pt-14",
          board && "lg:grid-cols-[1.05fr_1fr]",
        )}
      >
        <div className="gc-aurora" aria-hidden />

        <div className={cn("min-w-0 space-y-6", !board && "mx-auto max-w-2xl text-center")}>
          <h1 className="text-[2.9rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
            Every match
            <br />
            has a <span className="text-primary">story.</span>
          </h1>
          <p className="max-w-lg text-lg text-balance text-muted-foreground">
            Live scores, form and the full picture on every game that matters — and when you need to move a slip
            between bookmakers, GameClaw reads the code and rebuilds it.
          </p>

          <GetTheApp />

          <p className="text-xs text-muted-foreground">
            Free to follow football. Every pick we publish stays on the{" "}
            <Link href="/track-record" className="underline underline-offset-2 hover:text-foreground">
              public record
            </Link>
            , won or lost. 18+.
          </p>
        </div>

        <LiveNow board={board} />
      </section>

      <section aria-labelledby="features" className="space-y-8">
        <div className="max-w-2xl space-y-3">
          <h2 id="features" className="text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
            A football app that happens to be good with slips
          </h2>
          <p className="text-muted-foreground text-balance">
            Four things, done properly, instead of twenty half-finished ones.
          </p>
        </div>

        <div className="gc-reveal grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-card p-5 sm:p-8">
              <Icon className="mb-3 size-6 text-primary sm:mb-4" strokeWidth={1.75} aria-hidden />
              <p className="text-lg font-medium tracking-[-0.01em]">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <Screens />

      <TrackRecordSummary record={record} />

      <div className="gc-reveal">
        <Faq connected={connectedBookmakers().filter((b) => b.capabilities.loadCode).map((b) => b.name)} />
      </div>

      <section className="gc-reveal gc-claw gc-raised relative isolate overflow-hidden rounded-2xl border bg-card px-6 py-12 text-center sm:px-10">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
          Follow the game. Own your matchday.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-balance text-muted-foreground">
          Scores, stats and your teams, free. {cheapest ? "Chat and the daily picks are the paid part." : null}
        </p>
        <div className="mt-7">
          <GetTheApp align="center" />
        </div>
        {cheapest && (
          <p className="mt-6 text-xs text-muted-foreground">
            Chat and the daily picks start at{" "}
            <Link href="/pricing" className="text-primary hover:underline">
              GHS {cheapest.priceGhs} a day
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
