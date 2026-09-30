import type { Metadata } from "next";
import Link from "next/link";
import { NotifyToggle } from "@/components/picks/notify-toggle";
import { PickCard } from "@/components/picks/pick-card";
import { requireAdultPage } from "@/lib/auth-pages";
import { getTodaysPicks } from "@/lib/services/daily-picks";

export const metadata: Metadata = { title: "Daily picks" };

export default async function PicksPage() {
  const { user } = await requireAdultPage("/picks");
  const picks = await getTodaysPicks(user.id);

  return (
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
  );
}
