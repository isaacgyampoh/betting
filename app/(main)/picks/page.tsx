import type { Metadata } from "next";
import Link from "next/link";
import { NotifyToggle } from "@/components/picks/notify-toggle";
import { PickCard } from "@/components/picks/pick-card";
import { SpecialPickCard } from "@/components/picks/special-pick-card";
import { requireAdultPage } from "@/lib/auth-pages";
import { getTodaysPicks } from "@/lib/services/daily-picks";
import { specialToday } from "@/lib/services/special-picks";

export const metadata: Metadata = { title: "Daily picks" };

export default async function PicksPage() {
  const { user } = await requireAdultPage("/picks");
  const [picks, special] = await Promise.all([getTodaysPicks(user.id), specialToday()]);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Daily picks</h1>
            <p className="text-sm text-muted-foreground">
              One 2 odds and one 5 odds slip each morning, with the reason for every game.{" "}
              <Link href="/track-record" className="text-primary hover:underline">
                See the full record
              </Link>
              .
            </p>
          </div>
          {process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && <NotifyToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />}
        </div>

        {picks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Today&apos;s picks aren&apos;t published yet. They go up each morning once the day&apos;s fixtures and prices are in.
          </p>
        ) : (
          picks.map((p) => <PickCard key={p.id} pick={p} />)
        )}
      </div>

      {/* Daily Special Picks sits under the slips rather than on a page of its own: it is published
          by the same morning job, read by the same people, and a second picks page would split the
          one thing they came for in two. */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Daily Special Picks</h2>
          <p className="text-sm text-muted-foreground">
            Two selections a day in statistical markets — corners, shots, shots on target — researched from the teams&apos;
            recent matches, priced from a live bookmaker market and published together as one 2 odds slip. Both have to
            land. Some days nothing meets the threshold, and on those days nothing is published.{" "}
            <Link href="/track-record#special" className="text-primary hover:underline">
              See the record
            </Link>
            .
          </p>
        </div>

        {special === null ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No special pick today. Either the research is not in yet, or nothing met the threshold — which is a normal
            day, not a fault.
          </p>
        ) : (
          <div className="space-y-3">
            {special.slip.combinedOdds !== null && (
              <p className="text-sm text-muted-foreground">
                Together: <span className="gc-figure font-medium text-foreground">{special.slip.combinedOdds.toFixed(2)}</span>{" "}
                {special.picks.length === 1 ? "on one selection" : `across ${special.picks.length} selections`}.
              </p>
            )}
            {special.picks.map((p) => (
              <SpecialPickCard key={p.position} pick={p} />
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          The estimated chance is ours, worked out from the teams&apos; recent matches. It is not the bookmaker&apos;s
          price and it is not a guarantee. Odds move after publishing; the price shown is the one verified when the
          selection was published. Bet only what you can afford to lose. 18+.
        </p>
      </section>
    </div>
  );
}
