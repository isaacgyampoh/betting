import { redirect } from "next/navigation";
import { z } from "zod";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { requireAdultPage } from "@/lib/auth-pages";
import { lookupMatch } from "@/lib/services/stats";

export const metadata = { title: "Match stats" };

const querySchema = z.object({ home: z.string().min(1).max(80), away: z.string().min(1).max(80), kickoff: z.iso.datetime() });

// Bridges a bookmaker game (their team names) to the stats provider's fixture.
export default async function MatchLookupPage({ searchParams }: PageProps<"/matches/lookup">) {
  const params = await searchParams;
  await requireAdultPage(`/matches/lookup?${new URLSearchParams(params as Record<string, string>)}`);
  const q = querySchema.safeParse(params);
  const match = q.success ? await lookupMatch(q.data.home, q.data.away, new Date(q.data.kickoff)) : null;
  if (match) redirect(`/matches/${match.id}?d=${match.kickoffAt.slice(0, 10)}`);
  return (
    <ApiErrorNotice
      code="NOT_FOUND"
      message={q.success ? `We couldn't find stats for ${q.data.home} vs ${q.data.away}. Some leagues aren't covered.` : "That link is incomplete."}
    />
  );
}
