import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The published record, on the front page.
 *
 * A win rate and an ROI are rates, and a rate needs a sample. With one settled pick the page was
 * showing "0% win rate" and "-100% ROI" in red, which is arithmetic rather than information: it
 * reads as a measured record when it is one game. Below the threshold this shows the counts
 * instead, says why, and links to the ledger - where every pick is, settled or not, won or lost.
 *
 * Nothing is hidden by this. The counts are exact and the full record is one tap away; what is
 * withheld is a percentage that would mean nothing either way.
 */
const MIN_FOR_RATES = 10;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "win" | "loss" }) {
  return (
    <div className="bg-card p-4 text-center">
      <p className={cn("text-3xl font-semibold tracking-tight tabular-nums", tone === "win" && "text-win", tone === "loss" && "text-loss")}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function TrackRecordSummary({
  record,
}: {
  record: { won: number; lost: number; pending: number; winRate: number | null; roi: number | null } | null;
}) {
  const settled = record ? record.won + record.lost : 0;
  const enough = record && settled >= MIN_FOR_RATES;

  return (
    <section aria-labelledby="record" className="gc-reveal space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="record" className="text-lg font-semibold">
          Daily picks, in the open
        </h2>
        <Link href="/track-record" className="text-sm text-primary hover:underline">
          Full record
        </Link>
      </div>

      {settled === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
          Two picks go up every morning, built from real prices. Results appear here as the games finish — won or lost,
          never edited, never removed.
        </p>
      ) : enough ? (
        <>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
            <Stat label={settled === 1 ? "Pick settled" : "Picks settled"} value={String(settled)} />
            <Stat label="Win rate" value={record!.winRate === null ? "–" : `${record!.winRate}%`} />
            <Stat
              label="ROI, 1 unit a pick"
              value={record!.roi === null ? "–" : `${record!.roi}%`}
              tone={record!.roi !== null ? (record!.roi >= 0 ? "win" : "loss") : undefined}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Over {settled} settled picks. Every pick we publish stays on the record, won or lost. Nothing is edited or removed.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
            <Stat label="Won" value={String(record!.won)} tone={record!.won > 0 ? "win" : undefined} />
            <Stat label="Lost" value={String(record!.lost)} tone={record!.lost > 0 ? "loss" : undefined} />
            <Stat label="Still running" value={String(record!.pending)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Too few settled picks to quote a win rate yet — that needs {MIN_FOR_RATES}, and this is {settled}. Every one
            is already on the{" "}
            <Link href="/track-record" className="text-primary hover:underline">
              full record
            </Link>
            , won or lost, and nothing is edited or removed.
          </p>
        </>
      )}
    </section>
  );
}
