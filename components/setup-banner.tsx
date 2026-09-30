import { Wrench } from "lucide-react";
import { readiness } from "@/lib/readiness";

/** Shown site-wide while required configuration (e.g. the database) is missing. */
export function SetupBanner() {
  if (readiness().ready) return null;
  return (
    <div role="status" className="border-b bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <p className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-xs">
        <Wrench className="size-3.5 shrink-0" />
        We&apos;re finishing setup. Sign-in and slip tools will be available shortly.
      </p>
    </div>
  );
}
