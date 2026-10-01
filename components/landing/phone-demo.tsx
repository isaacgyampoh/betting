import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// The real flow, in a phone frame: paste a SportyBet code, see the games, then have a slip built to
// a target from today's prices.
//
// This is an illustration, not live output, and it is labelled "Example" on the page. The teams and
// markets are shown because they are the shape of what the app returns; the numbers are not quoted
// as today's prices anywhere. Never put a figure here that reads as a live price or a past result.
const GAMES = [
  { home: "Man United", away: "Tottenham", pick: "Man United to win", odds: "2.10" },
  { home: "Arsenal", away: "Newcastle", pick: "Arsenal to win or draw", odds: "1.16" },
  { home: "Kotoko", away: "Hearts of Oak", pick: "Over 1.5 goals", odds: "1.23" },
];

// Varied markets, as the builder really spreads them.
const BUILT = [
  { pick: "Over 9.5 corners", odds: "1.40" },
  { pick: "Both teams to score", odds: "1.58" },
  { pick: "Under 3.5 cards", odds: "1.62" },
];

/** `delay` staggers each row along the shared 12s timeline. */
function Step({ delay, className, children }: { delay: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("gc-demo-step", className)} style={{ animationDelay: delay }}>
      {children}
    </div>
  );
}

export function PhoneDemo({ className }: { className?: string }) {
  return (
    <figure className={cn("mx-auto w-full max-w-[300px]", className)}>
      <div className="rounded-[2rem] border-4 border-foreground/10 bg-card p-3 shadow-sm" aria-hidden="true">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/15" />

        <div className="space-y-2.5 text-sm">
          <div className="rounded-md border bg-background px-3 py-2">
            <p className="text-[10px] text-muted-foreground">Booking code</p>
            <p className="font-mono font-medium">
              <span className="gc-demo-type">BC7K2Q</span>
              <span className="gc-demo-caret">|</span>
            </p>
          </div>

          <Step delay="1.6s" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Check className="size-3 text-win" /> SportyBet · 3 games · 2.99
          </Step>

          <div className="divide-y overflow-hidden rounded-md border">
            {GAMES.map((g, i) => (
              <Step key={g.home} delay={`${2 + i * 0.45}s`} className="flex items-center justify-between gap-2 bg-background px-2.5 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {g.home} <span className="text-muted-foreground">v</span> {g.away}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">{g.pick}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold">{g.odds}</span>
              </Step>
            ))}
          </div>

          <Step delay="4.2s" className="flex items-center gap-1.5 text-[11px] font-medium">
            <Sparkles className="size-3" /> Build me a 5 odds
          </Step>

          <div className="space-y-1.5">
            {BUILT.map((b, i) => (
              <Step key={b.pick} delay={`${4.8 + i * 0.5}s`} className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5">
                <span className="truncate text-xs text-muted-foreground">{b.pick}</span>
                <span className="font-mono text-xs font-semibold">{b.odds}</span>
              </Step>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-muted-foreground">Example of the flow — not live odds.</figcaption>
    </figure>
  );
}
