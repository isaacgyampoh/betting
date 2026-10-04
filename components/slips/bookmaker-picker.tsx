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
  hideUnavailableNote,
}: {
  label: string;
  options: BookmakerOption[];
  value: string;
  onChange: (slug: string) => void;
  disabledSlug?: string;
  /** Adds a first "Auto-detect" choice. */
  withAuto?: boolean;
  /** Suppresses the "not connected yet" line, for when a sibling picker already shows it. */
  hideUnavailableNote?: boolean;
}) {
  // Bookmakers we cannot use are named in a line underneath rather than shown as dead buttons.
  // Six greyed-out options among nine made the grid look broken and squeezed the real ones until
  // their names truncated; one sentence says the same thing and reads better.
  const usable = options.filter((b) => b.available !== false);
  const all = withAuto ? [{ slug: AUTO, name: "Auto-detect", available: true }, ...usable] : usable;
  const unavailable = options.filter((b) => b.available === false);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {/* Two columns on a narrow phone: three left names like "Football.com" truncated. */}
      <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              // No border on the unselected ones: a grid of outlined boxes inside a panel is three
              // nested frames deep before any content. A filled chip is the control; the selected
              // one is the only thing that needs an outline.
              className={cn(
                "h-10 truncate rounded-lg px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                value === b.slug
                  ? "bg-card text-foreground ring-2 ring-primary"
                  : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {b.name}
            </button>
          );
        })}
      </div>
      {unavailable.length > 0 && !hideUnavailableNote && (
        <p className="text-xs text-muted-foreground">
          Not connected yet: {unavailable.map((b) => b.name).join(", ")}.
        </p>
      )}
    </fieldset>
  );
}
