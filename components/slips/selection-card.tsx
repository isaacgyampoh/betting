import { ArrowDown, ArrowUp, ChartNoAxesColumn } from "lucide-react";
import Link from "next/link";
import { TeamBadge } from "@/components/stats/team-badge";
import { cn } from "@/lib/utils";
import { formatKickoff, formatOdds } from "@/lib/format";
import { STATUS_REASON, type SelectionView } from "@/lib/slips/view";

function matchHref(s: SelectionView) {
  const q = new URLSearchParams({ home: s.home, away: s.away, kickoff: s.kickoffAt });
  return `/matches/lookup?${q}`;
}

function Team({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <p className="flex min-w-0 items-center gap-2">
      <TeamBadge team={{ id: 0, name, logo: logo ?? null }} size={18} />
      <span className="truncate">{name}</span>
    </p>
  );
}

/** One game on a slip: teams, league and kickoff, market and pick, price (and movement vs the source slip). */
export function SelectionCard({
  selection: s,
  selectable,
  selected,
  onToggle,
}: {
  selection: SelectionView;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const skipped = s.status !== "OK";
  const diff = s.sourceOdds != null && s.odds != null ? Math.round((s.odds - s.sourceOdds) * 100) / 100 : null;
  const problem = skipped ? STATUS_REASON[s.status as Exclude<typeof s.status, "OK">] : s.started ? "Already started" : !s.market ? "Market not supported yet" : null;

  return (
    <li
      className={cn(
        "grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 bg-card px-4 py-3 text-sm",
        skipped && "text-muted-foreground",
        selectable && "cursor-pointer hover:bg-accent",
        selected && "bg-accent outline-2 -outline-offset-2 outline-primary",
      )}
      onClick={selectable ? onToggle : undefined}
    >
      <div className="col-span-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          <span>{s.position}</span> · {s.competition ?? "Football"}
        </span>
        <time dateTime={s.kickoffAt} className="shrink-0">
          {formatKickoff(s.kickoffAt)}
        </time>
      </div>

      <div className="min-w-0 space-y-1 font-medium">
        <Team name={s.home} logo={s.homeLogo} />
        <Team name={s.away} logo={s.awayLogo} />
      </div>

      <div className="flex flex-col items-end justify-center">
        <span className={cn("gc-figure text-base font-semibold", skipped && "line-through")}>
          {formatOdds(skipped ? (s.sourceOdds ?? null) : s.odds)}
        </span>
        {s.sourceOdds != null && !skipped && diff !== null && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs",
              diff > 0 ? "text-win" : diff < 0 ? "text-loss" : "text-muted-foreground",
            )}
            title={`Was ${formatOdds(s.sourceOdds)}`}
          >
            {diff > 0 ? <ArrowUp className="size-3" /> : diff < 0 ? <ArrowDown className="size-3" /> : null}
            {diff === 0 ? "same" : `was ${formatOdds(s.sourceOdds)}`}
          </span>
        )}
      </div>

      <div className="col-span-2 flex items-center justify-between gap-2 border-t pt-2">
        <p className="min-w-0 truncate">
          <span className="text-muted-foreground">{s.marketLabel}: </span>
          <span className="font-medium text-foreground">{s.pickLabel}</span>
        </p>
        {!selectable && !skipped && (
          <Link
            href={matchHref(s)}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ChartNoAxesColumn className="size-3.5" /> Stats
          </Link>
        )}
      </div>

      {problem && <p className={cn("col-span-2 text-xs", skipped || s.started ? "text-loss" : "text-muted-foreground")}>{problem}</p>}
    </li>
  );
}
