import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { MatchList } from "@/components/stats/match-list";
import { SampleDataNotice } from "@/components/stats/sample-badge";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { requireAdultPage } from "@/lib/auth-pages";
import { AppError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { listMatches } from "@/lib/services/stats";

export const metadata: Metadata = { title: "Matches" };

function dayOffset(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAYS = [
  { label: "Yesterday", offset: -1 },
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "+2 days", offset: 2 },
];

export default async function MatchesPage({ searchParams }: PageProps<"/matches">) {
  await requireAdultPage("/matches");
  const date = z.iso.date().catch(dayOffset(0)).parse((await searchParams).date);

  let data: Awaited<ReturnType<typeof listMatches>> | null = null;
  let error: AppError | null = null;
  try {
    data = await listMatches(date);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    error = err;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Matches</h1>
        <p className="text-sm text-muted-foreground">Fixtures and head-to-head from API-Football.</p>
      </div>

      <nav aria-label="Date" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
        {DAYS.map((d) => {
          const value = dayOffset(d.offset);
          return (
            <Link
              key={d.offset}
              href={`/matches?date=${value}`}
              aria-current={value === date ? "page" : undefined}
              className={cn("rounded-md py-2 text-center text-xs font-medium", value === date ? "bg-background text-foreground" : "text-muted-foreground")}
            >
              {d.label}
            </Link>
          );
        })}
      </nav>

      {data?.source === "sample" && <SampleDataNotice />}
      {error && <ApiErrorNotice code={error.code} message={error.message} />}
      {data && <MatchList groups={data.groups} />}
    </div>
  );
}
