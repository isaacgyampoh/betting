import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { z } from "zod";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { AnalysisPanel } from "@/components/stats/analysis-panel";
import { FormChips } from "@/components/stats/form-chips";
import { SampleDataNotice } from "@/components/stats/sample-badge";
import { TeamBadge } from "@/components/stats/team-badge";
import { Button } from "@/components/ui/button";
import { requireAdultPage } from "@/lib/auth-pages";
import { AppError } from "@/lib/errors";
import { formatKickoff } from "@/lib/format";
import { cn } from "@/lib/utils";
import { matchInsights } from "@/lib/stats/insights";
import type { MatchDetail, MatchSummary, TeamForm } from "@/lib/stats/types";
import { getMatchDetail } from "@/lib/services/stats";

export const metadata: Metadata = { title: "Match stats" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ResultRow({ m }: { m: MatchSummary }) {
  return (
    <li className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatKickoff(m.kickoffAt).split(",")[0]}</span>
      <span className="min-w-0 flex-1 truncate text-right">{m.home.name}</span>
      <span className="w-12 shrink-0 text-center font-mono font-semibold">
        {m.goals.home}-{m.goals.away}
      </span>
      <span className="min-w-0 flex-1 truncate">{m.away.name}</span>
    </li>
  );
}

function FormCard({ form }: { form: TeamForm }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <TeamBadge team={form.team} size={24} /> <span className="truncate">{form.team.name}</span>
        </span>
        <FormChips results={form.matches.map((m) => m.result)} />
      </div>
      {form.matches.length ? (
        <ul className="divide-y">{form.matches.map((r) => <ResultRow key={r.match.id} m={r.match} />)}</ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No recent results.</p>
      )}
    </div>
  );
}

function Standings({ d }: { d: MatchDetail }) {
  const ids = new Set([d.match.home.id, d.match.away.id]);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-2 py-2 text-left">Team</th>
            <th className="px-2 py-2">P</th>
            <th className="px-2 py-2">GD</th>
            <th className="px-3 py-2">Pts</th>
          </tr>
        </thead>
        <tbody>
          {d.standings!.map((r) => (
            <tr key={r.team.id} className={cn("border-b last:border-0", ids.has(r.team.id) && "bg-primary/10 font-semibold")}>
              <td className="px-3 py-1.5">{r.rank}</td>
              <td className="max-w-40 truncate px-2 py-1.5">{r.team.name}</td>
              <td className="px-2 py-1.5 text-center">{r.played}</td>
              <td className="px-2 py-1.5 text-center">{r.goalsFor - r.goalsAgainst}</td>
              <td className="px-3 py-1.5 text-center">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MatchPage({ params }: PageProps<"/matches/[id]">) {
  const { id: rawId } = await params;
  const { user } = await requireAdultPage(`/matches/${rawId}`);
  const id = z.coerce.number().int().positive().safeParse(rawId);
  if (!id.success) notFound();

  let d: MatchDetail;
  try {
    d = await getMatchDetail(user, id.data);
  } catch (err) {
    if (err instanceof AppError) return <ApiErrorNotice code={err.code} message={err.message} />;
    throw err;
  }
  const m = d.match;
  const insights = matchInsights(d);

  return (
    <div className="space-y-6">
      <header className="rounded-xl border bg-card p-4">
        <p className="mb-3 text-center text-xs text-muted-foreground">
          {m.league.country} · {m.league.name} · {formatKickoff(m.kickoffAt)}
        </p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2 text-center">
            <TeamBadge team={m.home} size={48} />
            <span className="text-sm font-semibold">{m.home.name}</span>
          </div>
          <div className="text-center">
            {m.status === "SCHEDULED" ? (
              <span className="text-lg font-semibold text-muted-foreground">vs</span>
            ) : (
              <span className="font-mono text-2xl font-bold">
                {m.goals.home} - {m.goals.away}
              </span>
            )}
            <p className="text-xs text-muted-foreground">{m.statusLabel}</p>
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <TeamBadge team={m.away} size={48} />
            <span className="text-sm font-semibold">{m.away.name}</span>
          </div>
        </div>
        <Button asChild variant="outline" size="lg" className="mt-4 h-11 w-full">
          <Link href={`/chat?match=${m.id}`}>
            <MessageCircle data-icon="inline-start" /> Ask the AI about this match
          </Link>
        </Button>
      </header>

      {d.source === "sample" && <SampleDataNotice />}

      <AnalysisPanel matchId={m.id} />

      {insights.length > 0 && (
        <Section title="Key numbers">
          <ul className="space-y-1.5 rounded-xl border bg-card p-4 text-sm">
            {insights.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-primary">•</span> {s}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recent form (last 5)">
        <div className="grid gap-3 md:grid-cols-2">
          <FormCard form={d.form.home} />
          <FormCard form={d.form.away} />
        </div>
      </Section>

      <Section title="Head to head">
        {d.h2h.length ? (
          <ul className="divide-y rounded-xl border bg-card">{d.h2h.map((h) => <ResultRow key={h.id} m={h} />)}</ul>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No previous meetings found.</p>
        )}
      </Section>

      {d.standings && (
        <Section title="Standings">
          <Standings d={d} />
        </Section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Past results don&apos;t guarantee future outcomes. Stats: {d.source === "sample" ? "sample data" : "API-Football"}.
      </p>
    </div>
  );
}
