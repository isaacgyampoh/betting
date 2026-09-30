import { cn } from "@/lib/utils";
import type { FormResult } from "@/lib/stats/types";

const STYLE: Record<FormResult, string> = {
  W: "bg-win text-white",
  D: "bg-muted text-muted-foreground",
  L: "bg-loss text-white",
};

export function FormChips({ results }: { results: FormResult[] }) {
  return (
    <span className="inline-flex gap-1" aria-label={`Form: ${results.join(" ")}`}>
      {results.map((r, i) => (
        <span key={i} className={cn("inline-flex size-6 items-center justify-center rounded text-xs font-bold", STYLE[r])}>
          {r}
        </span>
      ))}
    </span>
  );
}
