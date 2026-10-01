import { Check, X } from "lucide-react";

// What a Ghanaian bettor actually puts up with, and what gameclaw does instead.
//
// Every line on the right has to be true of the app today. Nothing aspirational, no invented
// numbers, and no claim about bookmakers that are not connected yet.

const ROWS: { problem: string; fix: string }[] = [
  {
    problem: "A friend sends a code for a bookmaker you don't use",
    fix: "Paste it. We open it and book the same games on yours, with that bookmaker's own prices.",
  },
  {
    problem: "One bad leg kills a twenty-game ticket",
    fix: "Trim it to the odds you want, keep only the safest picks, or split it in two.",
  },
  {
    problem: "Tips arrive as a list of games with nothing behind them",
    fix: "Every pick says what actually happened: “7 of their last 10 went over 1.5”.",
  },
  {
    problem: "Checking a running ticket means reopening the app every few minutes",
    fix: "Ask how your ticket is doing and get every leg back with live scores.",
  },
  {
    problem: "Tipsters quietly delete the losers",
    fix: "Every pick we publish stays on the record, won or lost, and is never edited.",
  },
];

export function ProblemFix() {
  return (
    <section aria-labelledby="problem-fix" className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">The problem → the fix</p>
        <h2 id="problem-fix" className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
          Betting takes too many apps. This is one chat.
        </h2>
      </div>

      <ul className="divide-y border-y">
        {ROWS.map(({ problem, fix }) => (
          <li key={problem} className="grid gap-2 py-4 sm:grid-cols-2 sm:gap-8">
            <p className="flex gap-2.5 text-sm text-muted-foreground">
              <X className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{problem}</span>
            </p>
            <p className="flex gap-2.5 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-win" aria-hidden />
              <span>{fix}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
