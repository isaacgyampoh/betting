import type { Metadata } from "next";
import Link from "next/link";
import { NotifyToggle } from "@/components/picks/notify-toggle";
import { PickCard } from "@/components/picks/pick-card";
import { SpecialSlip } from "@/components/picks/special-slip";
import { requireAdultPage } from "@/lib/auth-pages";
import { getTodaysPicks } from "@/lib/services/daily-picks";
import { specialToday } from "@/lib/services/special-picks";

export const metadata: Metadata = { title: "Daily picks" };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gameclaw.win";

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

      {/* The Daily Special Slip sits under the accumulator picks rather than on a page of its own:
          it is published by the same morning job and read by the same people, and a second picks
          page would split the one thing they came for in two. */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Daily Special Slip</h2>
          <p className="text-sm text-muted-foreground">
            One researched accumulator a day: two or three matches in statistical markets — corners, shots, shots on
            target — combined to about 2.00. Every leg has to land. Some days no combination reaches the target, and
            on those days nothing is published.{" "}
            <Link href="/track-record#special" className="text-primary hover:underline">
              See the record
            </Link>
            .
          </p>
        </div>

        {special === null ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No slip today. Either the research has not run yet, or no combination of the day&apos;s qualifying
            selections reached the target — which is a normal day, not a fault.
          </p>
        ) : (
          <SpecialSlip slip={special} shareUrl={`${SITE}/special/${special.reference}`} />
        )}
      </section>
    </div>
  );
}
