"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TeamBadge } from "@/components/stats/team-badge";
import { ShareSlip } from "@/components/slips/share-slip";
import { formatKickoff, formatOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SlipView } from "@/lib/slips/view";

/** A slip shown inside the conversation: code, games and total, with a copy button. */
export function ChatSlipCard({ slip }: { slip: SlipView }) {
  const [copied, setCopied] = useState(false);
  const active = slip.selections.filter((s) => s.status === "OK");

  async function copy() {
    if (!slip.code) return;
    try {
      await navigator.clipboard.writeText(slip.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-sm">
      <div className="flex items-start justify-between gap-3 border-b px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{slip.bookmaker.name}</p>
          {slip.code ? (
            <button type="button" onClick={copy} className="flex items-center gap-1.5 font-mono font-medium" aria-label={`Copy code ${slip.code}`}>
              {slip.code}
              {copied ? <Check className="size-3.5 text-win" /> : <Copy className="size-3.5 text-muted-foreground" />}
            </button>
          ) : (
            <p className="text-muted-foreground">No code</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">
            {active.length} {active.length === 1 ? "game" : "games"}
          </p>
          <p className="text-lg font-semibold">{formatOdds(slip.totalOdds)}</p>
        </div>
      </div>

      <ul className="divide-y">
        {active.map((s) => (
          <li key={s.position} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate">
                <TeamBadge team={{ id: 0, name: s.home, logo: s.homeLogo ?? null }} size={14} />
                <span className="truncate">{s.home}</span>
                <span className="text-muted-foreground">v</span>
                <TeamBadge team={{ id: 0, name: s.away, logo: s.awayLogo ?? null }} size={14} />
                <span className="truncate">{s.away}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.pickLabel} · {formatKickoff(s.kickoffAt)}
              </p>
            </div>
            <span className={cn("shrink-0 font-medium", s.started && "text-loss")}>{formatOdds(s.odds)}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
        <span className="text-muted-foreground">{slip.demo ? "Demo data: this code won't work on the real site." : "Check on the bookmaker before betting."}</span>
        <span className="flex shrink-0 items-center gap-3">
          <ShareSlip
            compact
            slipId={slip.id}
            code={slip.code}
            bookmaker={slip.bookmaker.name}
            totalOdds={slip.totalOdds}
            games={slip.selections.length}
          />
          <Link href={`/slip?id=${slip.id}`} className="font-medium text-primary hover:underline">
            Open
          </Link>
        </span>
      </div>
    </div>
  );
}
