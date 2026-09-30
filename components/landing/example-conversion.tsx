import { cn } from "@/lib/utils";

// Illustration for the landing page. Labelled "Example"; these are not live odds.
const ROWS = [
  { match: "Man Utd v Tottenham", pick: "Man Utd", from: 2.0, to: 2.05 },
  { match: "Arsenal v Newcastle", pick: "Arsenal or Draw", from: 1.18, to: 1.17 },
  { match: "Kotoko v Hearts of Oak", pick: "Kotoko (+1)", from: 1.32, to: 1.35 },
  { match: "Nations FC v Karela Utd", pick: "Nations FC", from: 1.86, to: null },
];

export function ExampleConversion({ className }: { className?: string }) {
  return (
    <figure aria-label="Example: a SportyBet code converted to Betway" className={cn("overflow-hidden rounded-lg border bg-card text-left text-sm", className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground">SportyBet</span>
          <span className="font-mono font-medium">BC7K2Q</span>
          <span className="text-muted-foreground">→ Betway</span>
        </div>
        <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">Example</span>
      </div>

      <table className="w-full">
        <thead className="text-[11px] text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 text-left font-normal">Game</th>
            <th className="px-2 py-2 text-right font-normal">SportyBet</th>
            <th className="px-4 py-2 text-right font-normal">Betway</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.match} className="border-b last:border-0">
              <td className="px-4 py-2">
                <p className="truncate font-medium">{r.match}</p>
                <p className="truncate text-xs text-muted-foreground">{r.to ? r.pick : "Not listed on Betway"}</p>
              </td>
              <td className="px-2 py-2 text-right text-muted-foreground">{r.from.toFixed(2)}</td>
              <td
                className={cn(
                  "px-4 py-2 text-right font-medium",
                  r.to === null ? "text-muted-foreground" : r.to > r.from ? "text-win" : r.to < r.from ? "text-loss" : "",
                )}
              >
                {r.to === null ? "–" : r.to.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t bg-muted/50 px-4 py-3">
        <div>
          <p className="text-[11px] text-muted-foreground">New Betway code</p>
          <p className="font-mono font-medium">BW4T9X</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">3 of 4 games · total odds</p>
          <p className="font-semibold">3.24</p>
        </div>
      </div>
    </figure>
  );
}
