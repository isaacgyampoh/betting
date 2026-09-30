"use client";

import { useState } from "react";
import { ClipboardPaste, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, type ApiError } from "@/lib/api-client";
import type { SlipSummary, SlipView as Slip } from "@/lib/slips/view";
import { ApiErrorAlert } from "./api-error-alert";
import { AUTO, BookmakerPicker, type BookmakerOption } from "./bookmaker-picker";
import { RecentSlips } from "./recent-slips";
import { SlipView } from "./slip-view";

export function toSummary(s: Slip): SlipSummary {
  return { id: s.id, bookmaker: s.bookmaker, code: s.code, kind: s.kind, totalOdds: s.totalOdds, selectionCount: s.selectionCount, createdAt: s.createdAt };
}

export function CodeInput({ value, onChange, id = "code" }: { value: string; onChange: (v: string) => void; id?: string }) {
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text.trim().slice(0, 20).toUpperCase());
    } catch {
      /* permission denied; user can paste manually */
    }
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Booking code</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="e.g. BC7K2Q"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          className="h-11 font-mono text-base tracking-wider uppercase"
        />
        <Button type="button" variant="outline" size="icon" className="size-11" onClick={paste} aria-label="Paste code">
          <ClipboardPaste />
        </Button>
      </div>
    </div>
  );
}

export function SlipSkeleton({ label = "Loading slip" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <p className="text-center text-sm text-muted-foreground">{label}…</p>
      <Skeleton className="h-36 w-full rounded-lg" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function SlipWorkspace({
  bookmakers,
  initialRecent,
  initialSlip,
}: {
  bookmakers: BookmakerOption[];
  initialRecent: SlipSummary[];
  initialSlip: Slip | null;
}) {
  const [bookmaker, setBookmaker] = useState(AUTO);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [slips, setSlips] = useState<Slip[]>(initialSlip ? [initialSlip] : []);
  const [recent, setRecent] = useState(initialRecent);

  function show(next: Slip[]) {
    setSlips(next);
    setRecent((r) => [...next.map(toSummary), ...r.filter((x) => !next.some((n) => n.id === x.id))].slice(0, 8));
    if (next.length === 1) window.history.replaceState(null, "", `/slip?id=${next[0].id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function load(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    const chosen = override ?? bookmaker;
    if (!code.trim()) return;
    setPending(true);
    setError(null);
    const res = await apiFetch<Slip>("/api/v1/slips/load", {
      method: "POST",
      body: JSON.stringify({ code, ...(chosen !== AUTO ? { bookmaker: chosen } : {}) }),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setSlips([]);
      return;
    }
    show([res.data]);
  }

  async function openRecent(id: string) {
    setPending(true);
    setError(null);
    const res = await apiFetch<Slip>(`/api/v1/slips/${id}`);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setSlips([res.data]);

    window.history.replaceState(null, "", `/slip?id=${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={load} className="space-y-4 rounded-lg border bg-card p-4">
        <BookmakerPicker label="Bookmaker" options={bookmakers} value={bookmaker} onChange={setBookmaker} withAuto />
        <CodeInput value={code} onChange={setCode} />
        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending || !code.trim()}>
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {pending ? "Loading…" : "Load slip"}
        </Button>
      </form>

      {error && (
        <ApiErrorAlert
          error={error}
          onRetry={() => load()}
          onChooseBookmaker={(slug) => {
            setBookmaker(slug);
            void load(undefined, slug);
          }}
        />
      )}

      {pending ? (
        <SlipSkeleton />
      ) : (
        slips.map((s, i) => (
          <SlipView key={s.id} slip={s} title={slips.length > 1 ? `Slip ${i + 1} of ${slips.length}` : undefined} onEdited={show} />
        ))
      )}

      <RecentSlips slips={recent} activeId={slips.length === 1 ? slips[0].id : undefined} onOpen={openRecent} />
    </div>
  );
}
