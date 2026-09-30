"use client";

import { AlertTriangle, ArrowLeftRight, Check, Copy, CornerDownRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKickoff, formatOdds } from "@/lib/format";
import type { SlipView as Slip } from "@/lib/slips/view";
import { EditPanel } from "./edit-panel";
import { SelectionCard } from "./selection-card";

const KIND_LABEL: Record<string, string> = { CONVERTED: "Converted", EDITED: "Edited", SPLIT: "Split" };

export function SlipView({ slip, onEdited, title }: { slip: Slip; onEdited?: (slips: Slip[]) => void; title?: string }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removeSel, setRemoveSel] = useState<Set<number>>(new Set());

  const active = slip.selections.filter((s) => s.status === "OK");
  const skipped = slip.selections.filter((s) => s.status !== "OK");
  const parentSourceOdds = active.every((s) => s.sourceOdds != null)
    ? Math.round(active.reduce((p, s) => p * (s.sourceOdds ?? 1), 1) * 100) / 100
    : null;

  async function copyCode() {
    if (!slip.code) return;
    try {
      await navigator.clipboard.writeText(slip.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  function toggle(position: number) {
    setRemoveSel((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  return (
    <section aria-label={title ?? "Slip"} className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        {title && <p className="mb-2 text-sm font-semibold">{title}</p>}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{slip.bookmaker.name}</Badge>
              {KIND_LABEL[slip.kind] && <Badge variant="outline">{KIND_LABEL[slip.kind]}</Badge>}
            </div>
            {slip.code ? (
              <button type="button" onClick={copyCode} className="flex items-center gap-1.5 font-mono text-lg font-semibold tracking-wider" aria-label={`Copy code ${slip.code}`}>
                {slip.code}
                {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4 text-muted-foreground" />}
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">No code booked</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total odds</p>
            <p className="font-mono text-2xl font-bold text-primary tabular-nums">{formatOdds(slip.totalOdds)}</p>
            {slip.kind === "CONVERTED" && parentSourceOdds !== null && (
              <p className="text-xs text-muted-foreground tabular-nums">same picks were {formatOdds(parentSourceOdds)}</p>
            )}
          </div>
        </div>
        {slip.parent && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <CornerDownRight className="size-3" /> from {slip.parent.bookmaker.name} {slip.parent.code ?? ""}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {active.length} {active.length === 1 ? "game" : "games"}
            {skipped.length > 0 && <span className="text-destructive"> · {skipped.length} not carried over</span>}
          </span>
          {slip.expiresAt && <span className="text-xs">Last kickoff {formatKickoff(slip.expiresAt)}</span>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button asChild variant="outline" size="lg" className="h-11">
            <Link href={`/convert?from=${slip.id}`}>
              <ArrowLeftRight data-icon="inline-start" /> Convert
            </Link>
          </Button>
          <Button variant={editing ? "secondary" : "outline"} size="lg" className="h-11" onClick={() => setEditing((e) => !e)} disabled={!onEdited}>
            <Pencil data-icon="inline-start" /> Edit
          </Button>
        </div>
      </div>

      {editing && onEdited && (
        <EditPanel
          slip={slip}
          removeSelection={removeSel}
          onClose={() => setEditing(false)}
          onDone={(slips) => {
            setEditing(false);
            setRemoveSel(new Set());
            onEdited(slips);
          }}
        />
      )}

      {slip.warnings.map((w) => (
        <Alert key={w.code} variant={w.code === "STARTED" || w.code === "NOT_CONVERTED" ? "destructive" : "default"}>
          <AlertTriangle />
          <AlertDescription>
            {w.message} <span className="text-muted-foreground">(#{w.positions.join(", #")})</span>
          </AlertDescription>
        </Alert>
      ))}

      <ol className="space-y-3">
        {active.map((s) => (
          <SelectionCard key={s.position} selection={s} selectable={editing} selected={removeSel.has(s.position)} onToggle={() => toggle(s.position)} />
        ))}
      </ol>

      {skipped.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-destructive">Not carried over ({skipped.length})</h3>
          <ol className="space-y-3">
            {skipped.map((s) => (
              <SelectionCard key={s.position} selection={s} />
            ))}
          </ol>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Odds as shown when loaded; they may have changed. Always check the slip on the bookmaker before betting.
      </p>
    </section>
  );
}
