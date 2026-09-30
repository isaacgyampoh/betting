import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, BarChart3, MessageSquare, ReceiptText, Scissors } from "lucide-react";
import { redirect } from "next/navigation";
import { ExampleConversion } from "@/components/landing/example-conversion";
import { Button } from "@/components/ui/button";
import { getAuthUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: { absolute: "gameclaw: convert, trim and check betting slips in Ghana" },
  description:
    "Paste a SportyBet or Betway booking code. Convert it to another bookmaker, trim it to your target odds, and check form and head-to-head before you bet. 18+.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

const FEATURES = [
  { icon: ReceiptText, title: "Read any code", text: "Every game, market and price on a booking code, laid out in one list." },
  { icon: ArrowLeftRight, title: "Convert between bookmakers", text: "Nine bookmakers used in Ghana, with a fresh code. Games that can't be matched are listed, not dropped." },
  { icon: Scissors, title: "Cut it down", text: "Remove games, keep the safest picks, trim to a target total, or split one slip into several." },
  { icon: BarChart3, title: "Check the numbers", text: "Head-to-head and fixtures from API-Football before you commit." },
  { icon: MessageSquare, title: "Just ask", text: "\"Convert this to Betway.\" \"Make a 2 odds from it.\" Upload a screenshot of a slip and it reads it." },
];

const FAQ = [
  { q: "Is gameclaw a bookmaker?", a: "No. We don't take bets or hold money. You place bets directly with your bookmaker." },
  { q: "What does it cost?", a: "Loading, converting and trimming slips is always free, and so are a few chat messages a day. Paid plans start at GHS 10 for a day and add screenshot reading, slip building, match analysis and the daily picks." },
  { q: "Can it tell me who will win?", a: "No one can. It shows what the numbers say, with a confidence level and the reasons, and never promises a result." },
  { q: "Which bookmakers work?", a: "SportyBet, Betway, 1xBet, betPawa, MSport, Football.com, Betwinner, 22Bet and PariPesa. Paste any code and we detect the bookmaker. Some still run on sample data while their live connection is finished; those slips are clearly marked." },
];

export default async function HomePage() {
  // Signed-in users land in the conversation; the landing page is for visitors.
  if (await getAuthUser()) redirect("/chat");

  return (
    <div className="space-y-16 pb-4">
      <section className="grid items-center gap-10 pt-6 md:pt-12 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5 text-center lg:text-left">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">Paste a code. Convert it. Check the numbers.</h1>
          <p className="mx-auto max-w-xl text-balance text-muted-foreground lg:mx-0">
            Move booking codes between SportyBet, Betway, 1xBet, betPawa and more, cut them down to the odds you want, and see head-to-head before you bet.
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row lg:justify-start">
            <Button asChild size="lg" className="h-11 px-5">
              <Link href="/slip">
                Load a booking code <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5">
              <Link href="/convert">Convert a code</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Free slip tools. 18+ only.</p>
        </div>
        <ExampleConversion className="mx-auto w-full max-w-md" />
      </section>

      <section aria-labelledby="features" className="space-y-4">
        <h2 id="features" className="text-sm font-medium text-muted-foreground">What it does</h2>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-card p-4">
              <Icon className="mb-3 size-5 text-muted-foreground" strokeWidth={1.75} />
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
          <div className="flex flex-col justify-between bg-card p-4">
            <p className="text-sm font-medium">Plans from GHS 10</p>
            <p className="mt-1 text-sm text-muted-foreground">Mobile money or card. No auto-renewal.</p>
            <Link href="/pricing" className="mt-3 text-sm font-medium text-primary hover:underline">
              See plans
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq" className="space-y-3">
        <h2 id="faq" className="text-sm font-medium text-muted-foreground">Questions</h2>
        <div className="divide-y rounded-lg border bg-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="cursor-pointer list-none text-sm font-medium">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
