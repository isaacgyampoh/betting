"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatKickoff } from "@/lib/format";
import type { MatchSummary } from "@/lib/stats/types";
import { TeamBadge } from "./team-badge";

type Group = { league: MatchSummary["league"]; matches: MatchSummary[] };

export function MatchList({ groups }: { groups: Group[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      matches: needle
        ? g.matches.filter((m) => [m.home.name, m.away.name, g.league.name, g.league.country].some((s) => s.toLowerCase().includes(needle)))
        : g.matches,
    }))
    .filter((g) => g.matches.length);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team or league" className="h-11 pl-9" />
      </div>

      {filtered.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No matches found.</p>}

      {filtered.slice(0, 40).map((g) => (
        <section key={g.league.id} className="overflow-hidden rounded-lg border bg-card">
          <h2 className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            {g.league.logo && <TeamBadge team={{ id: g.league.id, name: g.league.name, logo: g.league.logo }} size={16} />}
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
                      <TeamBadge team={m.home} size={20} /> <span className="truncate">{m.home.name}</span>
                    </p>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <TeamBadge team={m.away} size={20} /> <span className="truncate">{m.away.name}</span>
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
    </div>
  );
}
