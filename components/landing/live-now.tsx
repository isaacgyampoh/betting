import Image from "next/image";
import type { Scoreboard } from "@/lib/services/public-matches";
import type { MatchSummary } from "@/lib/stats/types";
import { cn } from "@/lib/utils";

/**
 * Today's real card, on the front page.
 *
 * This is the proof, not the pitch. Every row is a fixture the provider is reporting right now,
 * with the minute it is actually on; a visitor who follows football can look at it and tell in a
 * second whether their league is in here. No screenshot or paragraph does that.
 *
 * The two teams are stacked with their scores on the right, which is both what the app's own Live
 * Centre does and the only layout that survives a phone: "Atlético Mineiro U20 v Amazonas" on one
 * line truncated to "Atlético Mineiro U20 v Amazonas ..." on a Pixel, and a single-line row has to
 * find space for the names, the score and the minute inside about 240px.
 *
 * It renders nothing at all when there is no data. That is deliberate - see `public-matches.ts`.
 */

/**
 * Country first, as everywhere else in the app.
 *
 * "Premier League" belongs to England, Bahrain, Armenia, Egypt and more, and the bare name reads
 * as England's wherever it appears - a live Bahraini fixture labelled "Premier League" on the
 * front page is a straightforwardly false impression. "World" is dropped because it prefixes the
 * continental cups, whose names are already unambiguous.
 */
function competition(league: MatchSummary["league"]): string {
  return league.country === "World" ? league.name : `${league.country} · ${league.name}`;
}

/**
 * What the right-hand label says.
 *
 * A fixture that has not kicked off reports its status as "Not Started", which on a phone wrapped
 * onto two lines next to a kick-off time that already said the same thing. The time is the useful
 * fact before kick-off, the minute is the useful fact during, and "FT" is the useful fact after.
 *
 * Ghana is UTC+0 year round and the audience is there, so the time is formatted in a fixed zone -
 * which also keeps server and client output identical, as a locale-dependent format would not.
 */
function statusLabel(match: MatchSummary): string {
  if (match.status === "LIVE") return match.statusLabel;
  if (match.status === "FINISHED") return "FT";
  if (match.status === "SCHEDULED") {
    return new Date(match.kickoffAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  }
  return match.statusLabel;
}

function Side({ name, goals, show, leading }: { name: string; goals: number | null; show: boolean; leading: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className={cn("min-w-0 flex-1 truncate text-sm", leading ? "font-semibold" : "font-medium")}>{name}</span>
      {show && (
        <span className={cn("gc-figure shrink-0 text-sm", leading ? "font-semibold" : "font-medium text-muted-foreground")}>
          {goals ?? 0}
        </span>
      )}
    </div>
  );
}

function Row({ match }: { match: MatchSummary }) {
  const live = match.status === "LIVE";
  const played = live || match.status === "FINISHED";
  const { home: hg, away: ag } = match.goals;

  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        {/* A light disc behind the crest. Plenty of competition badges - UEFA's especially - are
            dark artwork on a transparent background, and on ink they disappear into the row; the
            app's own list shows them on a white surface, so this is the same treatment rather than
            a new one. */}
        {match.league.logo ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/90">
            <Image src={match.league.logo} alt="" width={14} height={14} className="size-3.5 object-contain" loading="lazy" />
          </span>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{competition(match.league)}</span>
        <span className={cn("shrink-0 text-xs font-medium whitespace-nowrap", live ? "text-primary" : "text-muted-foreground")}>
          {live && (
            <span className="mr-1 inline-block size-1.5 rounded-full bg-primary align-middle motion-safe:animate-pulse" aria-hidden />
          )}
          {statusLabel(match)}
        </span>
      </div>

      <div className="space-y-0.5 pl-7">
        <Side name={match.home.name} goals={hg} show={played} leading={played && (hg ?? 0) > (ag ?? 0)} />
        <Side name={match.away.name} goals={ag} show={played} leading={played && (ag ?? 0) > (hg ?? 0)} />
      </div>
    </div>
  );
}

export function LiveNow({ board }: { board: Scoreboard | null }) {
  if (!board) return null;

  const rows = [...board.live, ...board.upcoming];
  if (rows.length === 0) return null;

  const more = board.listed - rows.length;

  return (
    <section aria-labelledby="live-now" className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="live-now" className="truncate text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {board.live.length > 0 ? `Live right now · ${board.live.length}` : "Today's football"}
        </h2>
        <span className="shrink-0 text-sm whitespace-nowrap text-muted-foreground">In the app</span>
      </div>

      <div className="gc-rows overflow-hidden rounded-xl border bg-card">
        {rows.map((match) => (
          <Row key={match.id} match={match} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {more > 0
          ? `And ${more} more on today's list, across every competition the app covers. Updated as they play.`
          : "Straight from the same feed the app uses. Updated as they play."}
      </p>
    </section>
  );
}
