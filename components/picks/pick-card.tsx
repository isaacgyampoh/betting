import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatKickoff, formatOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DailyPickView } from "@/lib/services/daily-picks";

const STATUS_STYLE: Record<string, string> = { WON: "text-win", LOST: "text-loss", VOID: "text-muted-foreground", PENDING: "text-muted-foreground" };
const STATUS_LABEL: Record<string, string> = { WON: "Won", LOST: "Lost", VOID: "Void", PENDING: "Not settled" };

export function PickCard({ pick }: { pick: DailyPickView }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-sm font-medium">Daily {pick.target} odds</p>
          <p className="text-xs text-muted-foreground">
            {pick.forDate} · {pick.confidence} confidence · {pick.chance}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold">{formatOdds(pick.totalOdds)}</p>
          <p className={cn("text-xs", STATUS_STYLE[pick.status])}>{STATUS_LABEL[pick.status]}</p>
        </div>
      </div>

      {pick.unlocked ? (
        <ul className="divide-y">
          {pick.legs.map((l) => (
            <li key={l.position} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {l.home} <span className="text-muted-foreground">v</span> {l.away}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.competition ?? "Football"} · {formatKickoff(l.kickoffAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">{formatOdds(l.odds)}</p>
                  {l.resultText && <p className={cn("text-xs", STATUS_STYLE[l.status])}>{l.resultText}</p>}
                </div>
              </div>
              <p className="mt-1">
                <span className="text-muted-foreground">{l.marketLabel}: </span>
                <span className="font-medium">{l.pickLabel}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{l.reason}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3 px-4 py-5 text-center">
          <Lock className="mx-auto size-5 text-muted-foreground" strokeWidth={1.75} />
          <p className="text-sm text-muted-foreground">
            Today&apos;s {pick.target} odds slip is ready with {pick.legs.length || "its"} games and the reasons behind each one.
          </p>
          <Button asChild size="sm">
            <Link href="/pricing">See plans</Link>
          </Button>
        </div>
      )}

      {pick.unlocked && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Estimates from prices and past results, not guarantees. Bet only what you can afford to lose.
        </p>
      )}
    </section>
  );
}
