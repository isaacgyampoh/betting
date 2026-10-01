import type { Metadata } from "next";
import { PickCard } from "@/components/picks/pick-card";
import { getTrackRecord } from "@/lib/services/daily-picks";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Track record",
  description: "Every daily pick gameclaw has published, with the result. Wins and losses, nothing hidden.",
  alternates: { canonical: "/track-record" },
};

// Public: no sign-in, and every published pick is shown with its result.
export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "win" | "loss" }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold", tone === "win" && "text-win", tone === "loss" && "text-loss")}>{value}</p>
    </div>
  );
}

export default async function TrackRecordPage() {
  const record = await getTrackRecord();
  const pct = (n: number | null) => (n === null ? "–" : `${n}%`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Track record</h1>
        <p className="text-sm text-muted-foreground">
          Every daily pick we&apos;ve published, with its result. Losses included; nothing is edited or removed after
          publishing. A pick still running shows its games once it settles.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Stat label="Picks settled" value={String(record.won + record.lost)} />
        <Stat label="Won" value={String(record.won)} tone={record.won > 0 ? "win" : undefined} />
        <Stat label="Win rate" value={pct(record.winRate)} />
        <Stat label="ROI (1 unit a pick)" value={pct(record.roi)} tone={record.roi !== null ? (record.roi >= 0 ? "win" : "loss") : undefined} />
      </div>

      {record.byTarget.some((t) => t.total > 0) && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-normal">Slip</th>
                <th className="px-2 py-2 text-right font-normal">Settled</th>
                <th className="px-2 py-2 text-right font-normal">Won</th>
                <th className="px-2 py-2 text-right font-normal">Win rate</th>
                <th className="px-4 py-2 text-right font-normal">ROI</th>
              </tr>
            </thead>
            <tbody>
              {record.byTarget.map((t) => (
                <tr key={t.target} className="border-b last:border-0">
                  <td className="px-4 py-2">Daily {t.target} odds</td>
                  <td className="px-2 py-2 text-right">{t.total}</td>
                  <td className="px-2 py-2 text-right">{t.won}</td>
                  <td className="px-2 py-2 text-right">{pct(t.winRate)}</td>
                  <td className={cn("px-4 py-2 text-right", t.roi !== null && (t.roi >= 0 ? "text-win" : "text-loss"))}>{pct(t.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {record.picks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No picks have been published yet. This page will fill in automatically, wins and losses alike.
        </p>
      ) : (
        <div className="space-y-3">
          {record.picks.map((p) => (
            <PickCard key={p.id} pick={p} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        ROI assumes one unit staked on each settled pick. Past results don&apos;t predict future ones. 18+.
      </p>
    </div>
  );
}
