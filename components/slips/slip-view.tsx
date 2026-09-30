"use client";

import { AlertTriangle, ArrowLeftRight, Check, Copy, Pencil } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKickoff, formatOdds } from "@/lib/format";
import type { SlipView as Slip } from "@/lib/slips/view";
import { SelectionCard } from "./selection-card";

export function SlipView({ slip }: { slip: Slip }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!slip.code) return;
    try {
      await navigator.clipboard.writeText(slip.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; ignore */
    }
  }

  return (
    <section aria-label="Slip" className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Badge variant="secondary">{slip.bookmaker.name}</Badge>
            {slip.code && (
              <button
                type="button"
                onClick={copyCode}
                className="flex items-center gap-1.5 font-mono text-lg font-semibold tracking-wider"
                aria-label={`Copy code ${slip.code}`}
              >
                {slip.code}
                {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4 text-muted-foreground" />}
              </button>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total odds</p>
            <p className="font-mono text-2xl font-bold text-primary tabular-nums">{formatOdds(slip.totalOdds)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {slip.selectionCount} {slip.selectionCount === 1 ? "game" : "games"}
          </span>
          {slip.expiresAt && <span className="text-xs">Last kickoff {formatKickoff(slip.expiresAt)}</span>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" disabled title="Coming in Milestone 3">
            <ArrowLeftRight data-icon="inline-start" /> Convert
            <Badge variant="secondary" className="ml-1">Soon</Badge>
          </Button>
          <Button variant="outline" size="lg" disabled title="Coming in Milestone 4">
            <Pencil data-icon="inline-start" /> Edit
            <Badge variant="secondary" className="ml-1">Soon</Badge>
          </Button>
        </div>
      </div>

      {slip.warnings.map((w) => (
        <Alert key={w.code} variant={w.code === "STARTED" ? "destructive" : "default"}>
          <AlertTriangle />
          <AlertDescription>
            {w.message} <span className="text-muted-foreground">(#{w.positions.join(", #")})</span>
          </AlertDescription>
        </Alert>
      ))}

      <ol className="space-y-3">
        {slip.selections.map((s) => (
          <SelectionCard key={s.position} selection={s} />
        ))}
      </ol>

      <p className="text-center text-xs text-muted-foreground">
        Odds shown when loaded and may have changed. Always check the slip on the bookmaker before betting.
      </p>
    </section>
  );
}
