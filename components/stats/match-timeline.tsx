import { ArrowLeftRight, CircleAlert, Goal, RectangleVertical, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeagueCoverage, MatchEvent } from "@/lib/stats/types";

/**
 * What happened, in order, with the home side on the left and the away side on the right.
 *
 * Nothing here is derived or guessed: every row is one event the provider reported. A competition
 * that does not carry events says so, rather than showing an empty panel that reads like a match
 * where nothing happened - and plenty do not, including Ghana's Division One League.
 */

const MINUTE = (e: MatchEvent) => `${e.minute}${e.extra ? `+${e.extra}` : ""}'`;

function Mark({ event }: { event: MatchEvent }) {
  switch (event.type) {
    case "GOAL":
    case "PENALTY":
      return <Goal className="size-4 text-win" strokeWidth={2} aria-hidden />;
    case "OWN_GOAL":
      return <Goal className="size-4 text-loss" strokeWidth={2} aria-hidden />;
    case "PENALTY_MISSED":
      return <CircleAlert className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden />;
    case "YELLOW":
      return <RectangleVertical className="size-4 fill-[#eab308] text-[#eab308]" aria-hidden />;
    case "SECOND_YELLOW":
    case "RED":
      return <RectangleVertical className="size-4 fill-loss text-loss" aria-hidden />;
    case "SUBSTITUTION":
      return <ArrowLeftRight className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden />;
    default:
      return <Video className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden />;
  }
}

/** The provider's own wording is the fallback, so an event we do not model still reads correctly. */
function describe(event: MatchEvent): string {
  switch (event.type) {
    case "GOAL":
      return event.other ? `Goal, assist ${event.other}` : "Goal";
    case "PENALTY":
      return "Penalty scored";
    case "OWN_GOAL":
      return "Own goal";
    case "PENALTY_MISSED":
      return "Penalty missed";
    case "YELLOW":
      return "Yellow card";
    case "SECOND_YELLOW":
      return "Second yellow";
    case "RED":
      return "Red card";
    case "SUBSTITUTION":
      return event.other ? `On for ${event.other}` : "Substitution";
    default:
      return event.detail || "VAR";
  }
}

export function MatchTimeline({ events, coverage }: { events: MatchEvent[]; coverage: LeagueCoverage | null }) {
  if (!events.length) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        {coverage && !coverage.events
          ? "This competition doesn't publish a match timeline, so there are no goals or cards to show here."
          : "No events yet."}
      </p>
    );
  }

  return (
    <ol className="gc-panel gc-rows">
      {events.map((e, i) => (
        <li key={`${e.minute}-${e.extra ?? 0}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className="gc-figure w-10 shrink-0 text-xs text-muted-foreground">{MINUTE(e)}</span>
          {/* Home on the left, away on the right, so the shape of the game reads down the column. */}
          <span className={cn("min-w-0 flex-1", e.side === "AWAY" && "order-3 text-right")}>
            <span className="block truncate font-medium">{e.player ?? describe(e)}</span>
            {e.player && <span className="block truncate text-xs text-muted-foreground">{describe(e)}</span>}
          </span>
          <span className="order-2 shrink-0">
            <Mark event={e} />
          </span>
          <span className={cn("min-w-0 flex-1", e.side === "HOME" && "order-3")} aria-hidden />
        </li>
      ))}
    </ol>
  );
}
