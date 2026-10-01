"use client";

import { cn } from "@/lib/utils";

export type BookmakerOption = {
  slug: string;
  name: string;
  /** False when we aren't connected to this bookmaker for what the picker is choosing. */
  available?: boolean;
};

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
  // Unconnected bookmakers stay visible but unselectable: hiding them entirely makes the list look
  // wrong to someone who uses one, and "coming soon" is the honest answer.
  const all = withAuto ? [{ slug: AUTO, name: "Auto-detect", available: true }, ...options] : options;
  const unavailable = options.filter((b) => b.available === false);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div role="radiogroup" className="grid grid-cols-3 gap-2">
        {all.map((b) => {
          const disabled = b.slug === disabledSlug || b.available === false;
          return (
            <button
              key={b.slug}
              type="button"
              role="radio"
              aria-checked={value === b.slug}
              disabled={disabled}
              title={b.available === false ? `${b.name} isn't connected yet` : undefined}
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
      {unavailable.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {unavailable.map((b) => b.name).join(", ")} {unavailable.length === 1 ? "isn't" : "aren't"} connected yet, so we
          can&apos;t use {unavailable.length === 1 ? "it" : "them"} here.
        </p>
      )}
    </fieldset>
  );
}
