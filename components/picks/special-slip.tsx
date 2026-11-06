import { formatKickoff, formatOdds } from "@/lib/format";
import type { SpecialSlipView } from "@/lib/services/special-picks";
import { cn } from "@/lib/utils";
import { SlipShare } from "@/components/picks/slip-share";

const STATUS_STYLE: Record<string, string> = { WON: "text-win", LOST: "text-loss", VOID: "text-muted-foreground", PENDING: "text-muted-foreground" };
const STATUS_LABEL: Record<string, string> = { WON: "Won", LOST: "Lost", VOID: "Void", PENDING: "Running" };
const BOOKMAKER_LABEL: Record<string, string> = { sportybet: "SportyBet", footballcom: "Football.com" };

const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * The Daily Special Slip.
 *
 * One publication, not a stack of cards. The legs are rows inside a single bordered panel because
 * they are one bet: an accumulator presented as separate cards invites reading each as its own
 * recommendation, which is exactly what this replaced.
 *
 * The combined price is the largest number on the page, as the thing being published. Each leg
 * still shows its own verified price and the research behind it, because a slip whose legs cannot
 * be checked is a tip rather than research.
 */
export function SpecialSlip({ slip, shareUrl }: { slip: SpecialSlipView; shareUrl?: string }) {
  const moved = slip.currentOdds !== null && Math.abs(slip.currentOdds - slip.combinedOdds) >= 0.01;

  return (
    <section className="gc-panel overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">gameclaw</p>
          <h3 className="text-lg font-semibold tracking-tight">Daily Special Slip</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {DATE.format(new Date(slip.date))} · {slip.legs.length} {slip.legs.length === 1 ? "match" : "matches"} ·{" "}
            <span className="gc-figure">{slip.reference}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">Combined odds</p>
          <p className="gc-figure text-4xl font-semibold leading-none">{formatOdds(slip.combinedOdds)}</p>
          <p className={cn("mt-1 text-xs", STATUS_STYLE[slip.status])}>{STATUS_LABEL[slip.status]}</p>
        </div>
      </header>

      <p className="border-b px-5 py-3 text-sm text-muted-foreground">{slip.summary}</p>

      <ol className="divide-y">
        {slip.legs.map((leg) => (
          <li key={leg.position} className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {leg.match.home} <span className="text-muted-foreground">v</span> {leg.match.away}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {leg.match.competition ?? "Football"} · {formatKickoff(leg.match.kickoffAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="gc-figure font-semibold">{formatOdds(leg.price.odds)}</p>
                {leg.status !== "PENDING" && (
                  <p className={cn("text-xs", STATUS_STYLE[leg.status])}>{STATUS_LABEL[leg.status]}</p>
                )}
              </div>
            </div>

            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">{leg.market.label}: </span>
              <span className="font-medium">
                {leg.market.outcome === "OVER" ? "Over" : "Under"} {leg.market.line}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{leg.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {leg.price.bookmaker ? (BOOKMAKER_LABEL[leg.price.bookmaker] ?? leg.price.bookmaker) : "no verified price"} ·
              our estimate {Math.round(leg.probability * 100)}%
              {leg.actual !== null && <> · match produced {leg.actual}</>}
            </p>
          </li>
        ))}
      </ol>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {slip.lastVerifiedAt ? `Prices last checked ${TIME.format(new Date(slip.lastVerifiedAt))} GMT` : "Prices as published"}
          {moved && <> · now {formatOdds(slip.currentOdds)}</>}
        </p>
        {shareUrl && <SlipShare reference={slip.reference} url={shareUrl} odds={slip.combinedOdds} legs={slip.legs.length} />}
      </footer>

      <p className="border-t px-5 py-2 text-xs text-muted-foreground">
        Research, not a guarantee. The estimate beside each selection is ours, from the teams&apos; recent matches; the
        odds are the bookmaker&apos;s and move after publishing. Every leg must land. 18+.
      </p>
    </section>
  );
}
