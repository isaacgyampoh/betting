"use client";

import { ArrowLeftRight, Check, Copy, CornerDownRight, Pencil, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatKickoff, formatOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SlipView as Slip } from "@/lib/slips/view";
import { ShareSlip } from "./share-slip";
import { EditPanel } from "./edit-panel";
import { SelectionCard } from "./selection-card";

const KIND_LABEL: Record<string, string> = { CONVERTED: "Converted", EDITED: "Edited", SPLIT: "Split" };

export function SlipView({ slip, onEdited, title }: { slip: Slip; onEdited?: (slips: Slip[]) => void; title?: string }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removeSel, setRemoveSel] = useState<Set<number>>(new Set());

  const active = slip.selections.filter((s) => s.status === "OK");
  const skipped = slip.selections.filter((s) => s.status !== "OK");
  const sourceTotal =
    slip.kind === "CONVERTED" && active.length && active.every((s) => s.sourceOdds != null)
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
    <section aria-label={title ?? "Slip"} className="space-y-3">
      <div className="gc-panel">
        <div className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-muted-foreground">
              {title ? `${title} · ` : ""}
              {slip.bookmaker.name}
              {KIND_LABEL[slip.kind] ? ` · ${KIND_LABEL[slip.kind]}` : ""}
            </p>
            {slip.code ? (
              <button
                type="button"
                onClick={copyCode}
                className="flex items-center gap-2 font-mono text-xl font-semibold tracking-wide"
                aria-label={`Copy code ${slip.code}`}
              >
                {slip.code}
                {copied ? <Check className="size-4 text-win" /> : <Copy className="size-4 text-muted-foreground" />}
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">No code booked</p>
            )}
            {slip.parent && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <CornerDownRight className="size-3" /> from {slip.parent.bookmaker.name} {slip.parent.code ?? ""}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">Total odds</p>
            <p className="gc-figure text-2xl font-semibold">{formatOdds(slip.totalOdds)}</p>
            {sourceTotal !== null && (
              <p className="text-xs text-muted-foreground">was {formatOdds(sourceTotal)}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                slip.risk.level === "low" ? "bg-win" : slip.risk.level === "medium" ? "bg-muted-foreground" : "bg-loss",
              )}
            />
            <span className="font-medium capitalize">{slip.risk.level} risk</span>
            <span className="text-muted-foreground">· {slip.risk.summary}</span>
          </span>
        </div>

        {slip.risk.riskiest.length > 0 && (
          <ul className="space-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
            {slip.risk.riskiest.map((r) => (
              <li key={r.position}>
                <span className="font-medium text-foreground">#{r.position}</span> {r.reason}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            {active.length} {active.length === 1 ? "game" : "games"}
            {skipped.length > 0 && <span className="text-loss"> · {skipped.length} not carried over</span>}
          </span>
          {slip.expiresAt && <span>Last kickoff {formatKickoff(slip.expiresAt)}</span>}
        </div>

        <div className="grid grid-cols-3 gap-px border-t bg-border">
          <Button asChild variant="ghost" className="h-11 rounded-none bg-card">
            <Link href={`/convert?from=${slip.id}`}>
              <ArrowLeftRight data-icon="inline-start" /> Convert
            </Link>
          </Button>
          <Button
            variant="ghost"
            className={cn("h-11 rounded-none bg-card", editing && "bg-accent")}
            onClick={() => setEditing((e) => !e)}
            disabled={!onEdited}
          >
            <Pencil data-icon="inline-start" /> Edit
          </Button>
          <div className="flex h-11 items-center justify-center bg-card">
            <ShareSlip
              slipId={slip.id}
              code={slip.code}
              bookmaker={slip.bookmaker.name}
              totalOdds={slip.totalOdds}
              games={slip.selections.length}
            />
          </div>
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

      {slip.demo && (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Demo data.</span> {slip.bookmaker.name} isn&apos;t connected to the real site yet, so
          this code and these prices are samples. The code won&apos;t work on {slip.bookmaker.name}.
        </p>
      )}

      {slip.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border px-4 py-3 text-sm">
          {slip.warnings.map((w) => (
            <li key={w.code} className="flex gap-2">
              <TriangleAlert
                className={cn("mt-0.5 size-4 shrink-0", w.code === "STARTED" || w.code === "NOT_CONVERTED" ? "text-loss" : "text-muted-foreground")}
              />
              <span>
                {w.message} <span className="text-muted-foreground">(#{w.positions.join(", #")})</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ol className="gc-panel divide-y">
        {active.map((s) => (
          <SelectionCard key={s.position} selection={s} selectable={editing} selected={removeSel.has(s.position)} onToggle={() => toggle(s.position)} />
        ))}
      </ol>

      {skipped.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Not carried over ({skipped.length})</h3>
          <ol className="gc-panel divide-y">
            {skipped.map((s) => (
              <SelectionCard key={s.position} selection={s} />
            ))}
          </ol>
        </div>
      )}

      <p className="text-xs text-muted-foreground">Prices as loaded; they change. Check the slip on the bookmaker before you bet.</p>
    </section>
  );
}
