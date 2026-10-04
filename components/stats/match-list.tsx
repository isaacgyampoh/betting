import Link from "next/link";
import { formatKickoff } from "@/lib/format";
import type { MatchSummary } from "@/lib/stats/types";
import { MatchSearch } from "./match-search";
import { TeamBadge } from "./team-badge";

type Group = { league: MatchSummary["league"]; matches: MatchSummary[] };

// A server component on purpose: a day's fixtures stay on the server, and only the ones being
// looked at are sent. The search box is the one client piece.
export function MatchList({ groups, hidden, query }: { groups: Group[]; hidden: number; query: string }) {
  return (
    <div className="space-y-4">
      <MatchSearch initial={query} />

      {groups.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {query ? `Nothing today matches "${query}".` : "No matches found."}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.league.id} className="gc-panel">
          <h2 className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            <TeamBadge team={{ id: g.league.id, name: g.league.name, logo: null }} size={16} logo={false} />
            <span className="truncate">
              {g.league.country} · {g.league.name}
            </span>
          </h2>
          <ul className="divide-y">
            {g.matches.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}?d=${m.kickoffAt.slice(0, 10)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <TeamBadge team={m.home} size={20} logo={false} /> <span className="truncate">{m.home.name}</span>
                    </p>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <TeamBadge team={m.away} size={20} logo={false} /> <span className="truncate">{m.away.name}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    {m.status === "SCHEDULED" ? (
                      <span className="text-muted-foreground">{formatKickoff(m.kickoffAt).split(", ")[1]}</span>
                    ) : (
                      <span className={m.status === "LIVE" ? "font-semibold text-loss" : "text-muted-foreground"}>
                        {m.goals.home ?? "-"} : {m.goals.away ?? "-"}
                        <br />
                        {m.statusLabel}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hidden > 0 && !query && (
        <p className="px-1 text-center text-xs text-muted-foreground">
          {hidden} more {hidden === 1 ? "game" : "games"} today in smaller leagues. Search a team or league to find them.
        </p>
      )}
    </div>
  );
}
