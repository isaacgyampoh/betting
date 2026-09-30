"use client";

import { cn } from "@/lib/utils";

export type BookmakerOption = { slug: string; name: string };

/** Picker value meaning "detect the bookmaker from the code". */
export const AUTO = "auto";

export function BookmakerPicker({
  label,
  options,
  value,
  onChange,
  disabledSlug,
  withAuto,
}: {
  label: string;
  options: BookmakerOption[];
  value: string;
  onChange: (slug: string) => void;
  disabledSlug?: string;
  /** Adds a first "Auto-detect" choice. */
  withAuto?: boolean;
}) {
  const all = withAuto ? [{ slug: AUTO, name: "Auto-detect" }, ...options] : options;
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div role="radiogroup" className="grid grid-cols-3 gap-2">
        {all.map((b) => {
          const disabled = b.slug === disabledSlug;
          return (
            <button
              key={b.slug}
              type="button"
              role="radio"
              aria-checked={value === b.slug}
              disabled={disabled}
              onClick={() => onChange(b.slug)}
              className={cn(
                "h-10 truncate rounded-lg border px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                value === b.slug ? "border-primary bg-card text-foreground ring-1 ring-primary" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {b.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
