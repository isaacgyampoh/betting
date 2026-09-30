"use client";

import { cn } from "@/lib/utils";

export type BookmakerOption = { slug: string; name: string };

export function BookmakerPicker({
  label,
  options,
  value,
  onChange,
  disabledSlug,
}: {
  label: string;
  options: BookmakerOption[];
  value: string;
  onChange: (slug: string) => void;
  disabledSlug?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div role="radiogroup" className="grid grid-cols-2 gap-2">
        {options.map((b) => {
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
                "h-11 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
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
