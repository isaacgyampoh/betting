import { Clock, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatKickoff, formatOdds } from "@/lib/format";
import type { SelectionView } from "@/lib/slips/view";

export function SelectionCard({ selection: s }: { selection: SelectionView }) {
  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 text-card-foreground",
        s.started && "border-destructive/40",
        !s.market && "border-dashed",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {s.position}. {s.competition ?? "Football"}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Clock className="size-3" />
          <time dateTime={s.kickoffAt}>{formatKickoff(s.kickoffAt)}</time>
        </span>
      </div>

      <p className="font-medium leading-snug">
        {s.home} <span className="text-muted-foreground">vs</span> {s.away}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{s.marketLabel}</p>
          <p className="truncate text-sm font-semibold">{s.pickLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {s.started && <Badge variant="destructive">Started</Badge>}
            {!s.market && (
              <Badge variant="outline" className="gap-1">
                <HelpCircle className="size-3" /> Unsupported market
              </Badge>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded-lg bg-primary/10 px-3 py-1.5 font-mono text-base font-semibold text-primary tabular-nums">
          {formatOdds(s.odds)}
        </span>
      </div>
    </li>
  );
}
