"use client";

import { Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatKickoff, formatOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReadSlip } from "@/lib/services/read-slip";

/**
 * What we read from an uploaded slip, shown for the user to check before we act on it.
 * Rows we couldn't read or match are flagged rather than quietly guessed.
 */
export function ReadSlipConfirm({ read, onConfirm }: { read: ReadSlip; onConfirm: () => void }) {
  const problems = read.rows.filter((r) => r.needsConfirmation);

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-sm">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="font-medium">What we read from your slip</p>
        <span className="text-xs text-muted-foreground">
          {read.bookmaker ?? "Bookmaker not shown"}
          {read.bookingCode ? ` · ${read.bookingCode}` : ""}
        </span>
      </div>

      <ul className="divide-y">
        {read.rows.map((r) => (
          <li key={r.index} className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate">
                  {r.match ? (
                    <>
                      {r.match.home} <span className="text-muted-foreground">v</span> {r.match.away}
                    </>
                  ) : (
                    <>
                      {r.read.home ?? "?"} <span className="text-muted-foreground">v</span> {r.read.away ?? "?"}
                    </>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.read.pick ?? r.read.market ?? "Pick unclear"}
                  {r.match ? ` · ${formatKickoff(r.match.kickoffAt)}` : ""}
                </p>
              </div>
              <span className={cn("gc-figure shrink-0 font-medium", r.read.odds === null && "text-muted-foreground")}>{formatOdds(r.read.odds)}</span>
            </div>
            {r.needsConfirmation && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-loss">
                <TriangleAlert className="mt-px size-3.5 shrink-0" /> {r.needsConfirmation}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t px-3 py-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {read.totalOddsComputed !== null ? "Total from the prices we read" : "Total unavailable (a price was unclear)"}
          </span>
          <span className="gc-figure font-medium">{formatOdds(read.totalOddsComputed)}</span>
        </div>
        {read.totalOddsRead !== null && read.totalOddsComputed !== null && Math.abs(read.totalOddsRead - read.totalOddsComputed) > 0.05 && (
          <p className="text-xs text-loss">The slip shows {formatOdds(read.totalOddsRead)}, so we may have misread a price.</p>
        )}
        {read.notes && <p className="text-xs text-muted-foreground">{read.notes}</p>}
        {problems.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {problems.length} of {read.rows.length} rows need checking. Correct anything wrong in your next message.
          </p>
        )}
        <Button size="sm" onClick={onConfirm} className="w-full">
          <Check data-icon="inline-start" /> Looks right, continue
        </Button>
      </div>
    </div>
  );
}
