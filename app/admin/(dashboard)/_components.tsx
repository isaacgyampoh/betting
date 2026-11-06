import Link from "next/link";
import type { Finding, Severity } from "@/lib/special-picks/integrity";

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

/**
 * A finding from the integrity rules.
 *
 * Three severities map to three tones and nothing else does. `info` is deliberately quiet: a price
 * moving against us is the market's opinion, not our mistake, and colouring it like a fault would
 * teach whoever reads this page to stop reading the colours.
 */
export function SeverityPill({ severity }: { severity: Severity | null }) {
  if (!severity) return <Pill state="ok">clean</Pill>;
  if (severity === "bad") return <Pill state="bad">needs attention</Pill>;
  if (severity === "warn") return <Pill state="warn">check</Pill>;
  return <Pill state="idle">note</Pill>;
}

export function FindingList({ findings }: { findings: readonly Finding[] }) {
  if (!findings.length) return null;
  const tone = { bad: "border-red-500/40 text-red-200", warn: "border-amber-400/40 text-amber-200", info: "border-zinc-600/50 text-zinc-400" };
  return (
    <ul className="space-y-1.5">
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`} className={`rounded border-l-2 bg-zinc-900/60 py-1.5 pl-3 pr-2 text-xs ${tone[f.severity]}`}>
          <code className="mr-2 text-[10px] uppercase tracking-wider opacity-60">{f.code}</code>
          {f.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Expected return per unit staked, shown whether or not it is a problem.
 *
 * The figure that was never on screen. A leg at 1.06 against our own estimate of 0.90 reads as a
 * safe price and a strong finding, and only the product of the two says it loses money.
 */
export function Ev({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-600">no price</span>;
  const tone = value < 0 ? "text-red-300" : value < 0.05 ? "text-amber-300" : "text-[#CCFF2E]";
  return (
    <span className={`tabular-nums font-medium ${tone}`}>
      {value >= 0 ? "+" : "−"}
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}
