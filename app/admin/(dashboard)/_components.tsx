import Link from "next/link";

/** A headline number. */
export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <h2 className="border-b border-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A green/amber/red pill. Takes a boolean or an explicit state, never a raw colour. */
export function Pill({ state, children }: { state: "ok" | "warn" | "bad" | "idle"; children: React.ReactNode }) {
  const tone = {
    ok: "bg-[#CCFF2E]/15 text-[#CCFF2E] border-[#CCFF2E]/30",
    warn: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    bad: "bg-red-500/10 text-red-300 border-red-500/30",
    idle: "bg-zinc-700/30 text-zinc-400 border-zinc-600/40",
  }[state];
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${tone}`}>{children}</span>
  );
}

/** Dates are rendered on the server in one place, so every page agrees on the format. */
export function When({ value }: { value: Date | string | null }) {
  if (!value) return <span className="text-zinc-600">never</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={d.toISOString()} className="tabular-nums text-zinc-400">
      {d.toISOString().slice(0, 16).replace("T", " ")}
    </time>
  );
}

export function Pager({ page, pages, base }: { page: number; pages: number; base: string }) {
  if (pages <= 1) return null;
  const join = (p: number) => `${base}${base.includes("?") ? "&" : "?"}page=${p}`;
  return (
    <div className="mt-4 flex items-center gap-2 text-sm">
      {page > 1 && (
        <Link href={join(page - 1)} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
          Previous
        </Link>
      )}
      <span className="text-zinc-500">
        Page {page} of {pages}
      </span>
      {page < pages && (
        <Link href={join(page + 1)} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
          Next
        </Link>
      )}
    </div>
  );
}
