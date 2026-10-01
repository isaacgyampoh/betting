"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// A bare spinner on a request that genuinely takes twenty seconds reads as broken. This says what
// the work is and roughly how long it runs, which is the difference between "slow" and "working".
//
// It never claims a stage it cannot know is happening: the line is chosen from what the user asked
// for, and the only thing that changes with time is a plain elapsed count after the first few
// seconds.

const LONG_AFTER_MS = 4000;

/** What the request is, inferred from the message, so the wait says something true about it. */
export function describeWork(message: string): { label: string; note?: string } {
  const m = message.toLowerCase();
  if (/\b(odds|acca|accumulator|build|slip for|ticket for)\b/.test(m) && !/\bconvert\b/.test(m)) {
    return { label: "Reading today's fixtures and recent form", note: "Usually about twenty seconds." };
  }
  if (/\bconvert\b/.test(m)) return { label: "Moving your games to the other bookmaker" };
  if (/\b(result|how is|how's|doing|won|lost)\b/.test(m)) return { label: "Checking the scores" };
  if (/^[a-z0-9]{5,10}$/i.test(message.trim())) return { label: "Opening your booking code" };
  return { label: "Checking" };
}

export function Thinking({ work }: { work: { label: string; note?: string } }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const long = seconds * 1000 >= LONG_AFTER_MS;
  return (
    <div className="flex items-start gap-2.5 text-sm text-muted-foreground" aria-live="polite">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
      <span>
        {work.label}
        {long && <span className="tabular-nums"> · {seconds}s</span>}
        {work.note && long && <span className="block text-xs opacity-80">{work.note}</span>}
      </span>
    </div>
  );
}
