import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, BarChart3, MessageCircle, ReceiptText, Scissors, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "gameclaw: convert, split and check betting slips in Ghana" },
  description:
    "Paste a SportyBet or Betway booking code, convert it to another bookmaker, trim it to your target odds, and check form and head-to-head before you bet. Free slip tools, optional AI assistant. 18+.",
};

const FEATURES = [
  { icon: ReceiptText, title: "Read any code", text: "Paste a booking code and see every game, market and odd in one clean list." },
  { icon: ArrowLeftRight, title: "Convert between bookmakers", text: "SportyBet ↔ Betway with a fresh code. Games that can't be matched are shown, never silently dropped." },
  { icon: Scissors, title: "Edit in seconds", text: "Remove games, keep the safest N, trim to a target total odds, or split into balanced slips." },
  { icon: BarChart3, title: "Stats before you bet", text: "Recent form, head-to-head and league tables, with the numbers that matter up front." },
  { icon: MessageCircle, title: "Just ask", text: "\"Convert this to Betway and drop anything above 2.0\". The assistant does it with real data only." },
  { icon: Smartphone, title: "Made for your phone", text: "Fast on mobile data. Add it to your home screen like an app." },
];

const STEPS = [
  { n: 1, title: "Paste your code", text: "From SportyBet or Betway." },
  { n: 2, title: "Convert or edit", text: "Pick a bookmaker, trim odds, or split." },
  { n: 3, title: "Copy the new code", text: "Load it on the bookmaker's site and check before you bet." },
];

const FAQ = [
  { q: "Is gameclaw a bookmaker?", a: "No. We don't take bets or hold money. We help you read, convert and edit booking codes, and look up stats. You bet directly with your bookmaker." },
  { q: "What's free?", a: "Loading, converting, editing and splitting slips, and match stats, are free with fair-use limits. The AI assistant has a few free requests, then plans start from GHS 5 a day." },
  { q: "Can the AI tell me who will win?", a: "No one can. The assistant only reports what the stats show and never invents odds or results. Stats, not guarantees." },
  { q: "Which bookmakers are supported?", a: "SportyBet and Betway Ghana today; betPawa, 1xBet and MSport are next." },
];

export default function HomePage() {
  return (
    <div className="space-y-14 pb-4">
      <section className="space-y-5 pt-6 text-center md:pt-12">
        <p className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" /> Built for Ghanaian bettors · 18+
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-balance md:text-5xl">Your betting slips, sorted.</h1>
        <p className="mx-auto max-w-xl text-balance text-muted-foreground">
          Convert booking codes between SportyBet and Betway, trim them to the odds you want, and check the stats first, all in one place.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild size="lg" className="h-12 px-6">
            <Link href="/slip">
              Load a booking code <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6">
            <Link href="/convert">Convert a code</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="how" className="space-y-4">
        <h2 id="how" className="text-center text-xl font-semibold">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border bg-card p-4">
              <span className="mb-2 inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{s.n}</span>
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="features" className="space-y-4">
        <h2 id="features" className="text-center text-xl font-semibold">Everything you do with a slip</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border bg-card p-4">
              <Icon className="mb-2 size-6 text-primary" />
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-primary/5 p-6 text-center">
        <h2 className="text-xl font-semibold">Free slip tools. AI when you want it.</h2>
        <p className="mt-1 text-sm text-muted-foreground">AI plans from GHS 5 a day. Pay with mobile money or card, no auto-renewal.</p>
        <Button asChild variant="outline" size="lg" className="mt-4 h-11">
          <Link href="/pricing">See plans</Link>
        </Button>
      </section>

      <section aria-labelledby="faq" className="space-y-3">
        <h2 id="faq" className="text-xl font-semibold">Questions</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-xl border bg-card p-4">
            <summary className="cursor-pointer list-none font-medium">{f.q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
