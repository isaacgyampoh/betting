import { ArrowDownRight, ArrowUpRight, BarChart3, Clock, HelpCircle, XCircle } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatKickoff, formatOdds } from "@/lib/format";
import { STATUS_REASON, type SelectionView } from "@/lib/slips/view";

function matchHref(s: SelectionView) {
  const q = new URLSearchParams({ home: s.home, away: s.away, kickoff: s.kickoffAt });
  return `/matches/lookup?${q}`;
}

export function SelectionCard({ selection: s, selectable, selected, onToggle }: {
  selection: SelectionView;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const skipped = s.status !== "OK";
  const diff = s.sourceOdds != null && s.odds != null ? s.odds - s.sourceOdds : null;

  return (
    <li
      className={cn(
        "relative rounded-xl border bg-card p-4 text-card-foreground",
        s.started && !skipped && "border-destructive/40",
        (!s.market || skipped) && "border-dashed",
        skipped && "opacity-80",
        selectable && "cursor-pointer",
        selected && "ring-2 ring-primary",
      )}
      onClick={selectable ? onToggle : undefined}
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
            {skipped && (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="size-3" /> {STATUS_REASON[s.status as Exclude<typeof s.status, "OK">]}
              </Badge>
            )}
            {!skipped && s.started && <Badge variant="destructive">Started</Badge>}
            {!skipped && !s.market && (
              <Badge variant="outline" className="gap-1">
                <HelpCircle className="size-3" /> Unsupported market
              </Badge>
            )}
            {!selectable && (
              <Link
                href={matchHref(s)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <BarChart3 className="size-3" /> Stats
              </Link>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {s.sourceOdds != null && !skipped && (
            <p className="mb-1 flex items-center justify-end gap-0.5 text-xs text-muted-foreground tabular-nums">
              was {formatOdds(s.sourceOdds)}
              {diff !== null && diff !== 0 &&
                (diff > 0 ? <ArrowUpRight className="size-3 text-primary" /> : <ArrowDownRight className="size-3 text-destructive" />)}
            </p>
          )}
          <span
            className={cn(
              "inline-block rounded-lg px-3 py-1.5 font-mono text-base font-semibold tabular-nums",
              skipped ? "bg-muted text-muted-foreground line-through" : "bg-primary/10 text-primary",
            )}
          >
            {formatOdds(skipped ? (s.sourceOdds ?? null) : s.odds)}
          </span>
        </div>
      </div>
    </li>
  );
}
