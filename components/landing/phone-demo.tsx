import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// The real flow, in a phone frame: paste a code, the games appear, convert to every bookmaker.
// Teams and prices match the sample slip the app actually returns, so nothing here is invented.
const GAMES = [
  { home: "Man United", away: "Tottenham", pick: "Man United", odds: "2.10" },
  { home: "Arsenal", away: "Newcastle", pick: "Arsenal or Draw", odds: "1.16" },
  { home: "Kotoko", away: "Hearts of Oak", pick: "Kotoko (+1)", odds: "1.23" },
];
const CONVERTED = [
  { name: "Betway", code: "BW4T9X" },
  { name: "1xBet", code: "7KQ2M" },
  { name: "betPawa", code: "BP7431" },
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
    <div className={cn("mx-auto w-full max-w-[300px]", className)} aria-hidden="true">
      <div className="rounded-[2rem] border-4 border-foreground/10 bg-card p-3 shadow-sm">
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
            <ArrowRight className="size-3" /> Convert to all
          </Step>

          <div className="space-y-1.5">
            {CONVERTED.map((c, i) => (
              <Step key={c.name} delay={`${4.8 + i * 0.5}s`} className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">{c.name}</span>
                <span className="font-mono text-xs font-semibold">{c.code}</span>
              </Step>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
