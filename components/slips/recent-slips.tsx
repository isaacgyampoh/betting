"use client";

import { ChevronRight, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOdds, timeAgo } from "@/lib/format";
import type { SlipSummary } from "@/lib/slips/view";

export function RecentSlips({ slips, activeId, onOpen }: { slips: SlipSummary[]; activeId?: string; onOpen: (id: string) => void }) {
  return (
    <section aria-labelledby="recent-heading" className="space-y-2">
      <h2 id="recent-heading" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <History className="size-4" /> Recent slips
      </h2>
      {slips.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Slips you load will appear here.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {slips.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent", s.id === activeId && "bg-accent/60")}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold tracking-wider">{s.code ?? "Edited slip"}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.bookmaker.name} · {s.selectionCount} games · {timeAgo(s.createdAt)}
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums">{formatOdds(s.totalOdds)}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
