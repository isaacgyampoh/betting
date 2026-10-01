import { ClipboardPaste, LineChart, Sparkles } from "lucide-react";

// Three ways in, each shown as the exchange it really is. The codes here are illustrations, and the
// section says so once rather than on every card.

type Flow = {
  icon: typeof Sparkles;
  title: string;
  you: string;
  reply: string;
  detail: string[];
  footer: string;
};

const FLOWS: Flow[] = [
  {
    icon: ClipboardPaste,
    title: "Got a code?",
    you: "BC7K2Q",
    reply: "SportyBet, 8 games at 34.91.",
    detail: ["Man United v Tottenham — Man United to win", "Arsenal v Newcastle — Over 1.5 goals", "+ 6 more games"],
    footer: "See every game and price on it, then move it to another bookmaker.",
  },
  {
    icon: Sparkles,
    title: "No code?",
    you: "Build me a safe 5 odds for today",
    reply: "Built from today's prices — 5.02.",
    detail: [
      "Seattle v Sporting KC — Over 2 goals @ 1.15",
      "Their games went over 2 in 5 of 10 and 6 of 10",
      "+ 4 more, each with its own reason",
    ],
    footer: "Real fixtures, real prices, and a booking code you can paste.",
  },
  {
    icon: LineChart,
    title: "Ticket running?",
    you: "How's my ticket doing?",
    reply: "5 won, 2 still live.",
    detail: ["Adelaide 2-1 Eastern United — won", "Shimizu 0-0 Yokohama — Over 1.5, 52'", "Needs 2 goals in about 38 minutes"],
    footer: "Live scores for every leg, and what each one still needs.",
  },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how" className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-widest text-primary uppercase">Say it, and it&apos;s done</p>
          <h2 id="how" className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
            Three ways to start.
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">Examples of the flow — not live odds.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FLOWS.map(({ icon: Icon, title, you, reply, detail, footer }) => (
          <div key={title} className="flex flex-col rounded-lg border bg-card">
            <p className="flex items-center gap-2 border-b px-4 py-3 font-medium">
              <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              {title}
            </p>

            <div className="flex-1 space-y-2.5 p-4">
              <p className="ml-auto w-fit max-w-[90%] rounded-lg bg-secondary px-3 py-2 text-sm">{you}</p>
              <div className="space-y-1.5 rounded-lg border bg-background px-3 py-2.5">
                <p className="text-sm font-medium">{reply}</p>
                <ul className="space-y-1">
                  {detail.map((d) => (
                    <li key={d} className="truncate text-xs text-muted-foreground">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="border-t px-4 py-3 text-sm text-muted-foreground">{footer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
