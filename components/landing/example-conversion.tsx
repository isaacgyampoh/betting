import { ArrowDown, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Illustration for the landing page. Labelled "Example"; these are not live odds.
const ROWS = [
  { match: "Man Utd vs Tottenham", pick: "Man Utd", from: "2.00", to: "2.05" },
  { match: "Arsenal vs Newcastle", pick: "Arsenal or Draw", from: "1.18", to: "1.17" },
  { match: "Kotoko vs Hearts of Oak", pick: "Kotoko (+1)", from: "1.32", to: "1.35" },
  { match: "Nations FC vs Karela Utd", pick: "Nations FC", from: "1.86", to: null },
];

export function ExampleConversion({ className }: { className?: string }) {
  return (
    <figure aria-label="Example of converting a SportyBet code to Betway" className={cn("rounded-2xl border bg-card p-4 text-left shadow-xl shadow-primary/5", className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">SportyBet</p>
          <p className="font-mono font-semibold tracking-wider">BC7K2Q</p>
        </div>
        <Badge variant="outline">Example</Badge>
      </div>

      <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowDown className="size-3.5 text-primary" /> Converted to Betway in seconds
      </div>

      <ul className="space-y-1.5">
        {ROWS.map((r) => (
          <li key={r.match} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", !r.to && "border-dashed opacity-80")}>
            {r.to ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : <XCircle className="size-4 shrink-0 text-destructive" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.match}</p>
              <p className="truncate text-xs text-muted-foreground">{r.to ? r.pick : "Not on Betway: shown, not dropped"}</p>
            </div>
            <span className="shrink-0 text-right font-mono text-xs tabular-nums">
              {r.to ? (
                <>
                  <span className="text-muted-foreground line-through">{r.from}</span> <span className="font-semibold text-primary">{r.to}</span>
                </>
              ) : (
                <span className="text-muted-foreground line-through">{r.from}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2">
        <div>
          <p className="text-xs text-muted-foreground">New Betway code</p>
          <p className="font-mono font-semibold tracking-wider text-primary">BW4T9X</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total odds</p>
          <p className="font-mono font-bold tabular-nums">3.24</p>
        </div>
      </div>
    </figure>
  );
}
