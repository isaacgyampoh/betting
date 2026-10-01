"use client";

import { useSyncExternalStore } from "react";

// An empty chat should feel like an invitation, not a form.
//
// The greeting depends on the reader's own clock, which the server cannot know, so it is read as an
// external value: null on the server and on the first client render, the real greeting after
// hydration. That keeps the markup identical on both sides without a layout jump, since the heading
// holds its line either way.

function partOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Stable within the hour, which is all `useSyncExternalStore` needs of it. */
const readGreeting = () => partOfDay(new Date().getHours());
const noServerGreeting = () => null;
const neverChanges = () => () => {};

export function ChatGreeting({ name, children }: { name: string | null; children: React.ReactNode }) {
  const greeting = useSyncExternalStore(neverChanges, readGreeting, noServerGreeting);

  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6 px-2 text-center">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {/* A non-breaking space holds the line before hydration, so nothing shifts. */}
          {greeting ? `${greeting}${name ? `, ${name}` : ""}` : " "}
        </h1>
        <p className="text-muted-foreground">What do you want to do?</p>
      </div>
      {children}
    </div>
  );
}
