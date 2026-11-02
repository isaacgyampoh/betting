import { formatKickoff, formatOdds } from "@/lib/format";
import type { PublishedSpecialPick } from "@/lib/services/special-picks";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = { WON: "text-win", LOST: "text-loss", VOID: "text-muted-foreground", PENDING: "text-muted-foreground" };
const STATUS_LABEL: Record<string, string> = { WON: "Won", LOST: "Lost", VOID: "Void", PENDING: "Not settled" };
const BOOKMAKER_LABEL: Record<string, string> = { sportybet: "SportyBet", football: "Football.com" };

/**
 * One published special selection.
 *
 * The brief's hard rule shows up in the markup rather than only in the data: the bookmaker's price,
 * our estimated chance and the value implied by the two are three separately labelled figures. A
 * single "odds" number next to a percentage is how an estimate ends up being read as a price.
 *
 * Built from the same parts as PickCard - gc-panel, a bordered header, divided rows, the win and
 * loss tokens - because this belongs to the picks pages rather than announcing itself as new.
 */
export function SpecialPickCard({ pick }: { pick: PublishedSpecialPick }) {
  const chance = Math.round(pick.probability * 100);
  // Value is derived here, from the two figures above it, and is only meaningful with a price.
  const value = pick.price.odds === null ? null : pick.probability * pick.price.odds - 1;
  const evidence = pick.evidence as { sample?: number; hitRate?: number; mean?: number; coverage?: number };
  const book = pick.price.bookmaker ? (BOOKMAKER_LABEL[pick.price.bookmaker] ?? pick.price.bookmaker) : null;

  return (
    <section className="gc-panel">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {pick.match.home} <span className="text-muted-foreground">v</span> {pick.match.away}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {pick.match.competition ?? "Football"}
            {pick.match.country ? `, ${pick.match.country}` : ""} · {formatKickoff(pick.match.kickoffAt)}
          </p>
        </div>
        <p className={cn("shrink-0 text-xs", STATUS_STYLE[pick.status])}>{STATUS_LABEL[pick.status]}</p>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm">
          <span className="text-muted-foreground">{pick.market.label}: </span>
          <span className="font-medium">
            {pick.market.outcome === "OVER" ? "Over" : "Under"} {pick.market.line}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{pick.reason}</p>
      </div>

      {/* Three figures, three labels. Nothing here is interchangeable with anything else here. */}
      <dl className="grid grid-cols-3 gap-px border-t bg-border text-sm">
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Bookmaker odds</dt>
          <dd className="gc-figure font-semibold">{formatOdds(pick.price.odds)}</dd>
          <dd className="text-xs text-muted-foreground">{book ?? "no verified price"}</dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Our estimated chance</dt>
          <dd className="gc-figure font-semibold">{chance}%</dd>
          <dd className="text-xs text-muted-foreground">{pick.confidence} confidence</dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Estimated value</dt>
          <dd className={cn("gc-figure font-semibold", value !== null && (value > 0 ? "text-win" : "text-loss"))}>
            {value === null ? "–" : `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`}
          </dd>
          <dd className="text-xs text-muted-foreground">per unit staked</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          {evidence.sample ? `${evidence.sample} recent matches` : "Researched"}
          {evidence.mean !== undefined ? `, averaging ${evidence.mean}` : ""}
          {evidence.hitRate !== undefined ? ` · hit ${Math.round(evidence.hitRate * 100)}% of the time` : ""}
        </span>
        {pick.actual !== null && (
          <span>
            Match result: <span className="gc-figure text-foreground">{pick.actual}</span>
          </span>
        )}
      </div>
    </section>
  );
}
