"use client";

import { useState } from "react";
import { AlertCircle, CalendarX, ClipboardPaste, Loader2, RotateCw, Timer, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, type ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SlipSummary, SlipView as Slip } from "@/lib/slips/view";
import { RecentSlips } from "./recent-slips";
import { SlipView } from "./slip-view";

type Bookmaker = { slug: string; name: string };

const ERROR_UI: Record<string, { title: string; icon: typeof AlertCircle; retry?: boolean }> = {
  INVALID_CODE: { title: "Code not found", icon: AlertCircle },
  EXPIRED_CODE: { title: "Code expired", icon: CalendarX },
  BOOKMAKER_UNAVAILABLE: { title: "Bookmaker unavailable", icon: WifiOff, retry: true },
  RATE_LIMITED: { title: "Slow down", icon: Timer },
  NETWORK: { title: "You're offline", icon: WifiOff, retry: true },
};

function toSummary(s: Slip): SlipSummary {
  return { id: s.id, bookmaker: s.bookmaker, code: s.code, totalOdds: s.totalOdds, selectionCount: s.selectionCount, createdAt: s.createdAt };
}

export function SlipWorkspace({
  bookmakers,
  initialRecent,
  initialSlip,
}: {
  bookmakers: Bookmaker[];
  initialRecent: SlipSummary[];
  initialSlip: Slip | null;
}) {
  const [bookmaker, setBookmaker] = useState(initialSlip?.bookmaker.slug ?? bookmakers[0]?.slug ?? "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [slip, setSlip] = useState<Slip | null>(initialSlip);
  const [recent, setRecent] = useState(initialRecent);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    if (!code.trim() || !bookmaker) return;
    setPending(true);
    setError(null);
    const res = await apiFetch<Slip>("/api/v1/slips/load", {
      method: "POST",
      body: JSON.stringify({ bookmaker, code }),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setSlip(null);
      return;
    }
    setSlip(res.data);
    setRecent((r) => [toSummary(res.data), ...r.filter((x) => x.id !== res.data.id)].slice(0, 8));
    window.history.replaceState(null, "", `/slip?id=${res.data.id}`);
  }

  async function openRecent(id: string) {
    setPending(true);
    setError(null);
    const res = await apiFetch<Slip>(`/api/v1/slips/${id}`);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setSlip(res.data);
    setBookmaker(res.data.bookmaker.slug);
    window.history.replaceState(null, "", `/slip?id=${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setCode(text.trim().slice(0, 20).toUpperCase());
    } catch {
      /* permission denied; user can paste manually */
    }
  }

  const errorUi = error ? (ERROR_UI[error.code] ?? { title: "Something went wrong", icon: AlertCircle, retry: true }) : null;

  return (
    <div className="space-y-6">
      <form onSubmit={load} className="space-y-4 rounded-xl border bg-card p-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Bookmaker</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {bookmakers.map((b) => (
              <button
                key={b.slug}
                type="button"
                role="radio"
                aria-checked={bookmaker === b.slug}
                onClick={() => setBookmaker(b.slug)}
                className={cn(
                  "h-11 rounded-lg border text-sm font-medium transition-colors",
                  bookmaker === b.slug ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {b.name}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="code">Booking code</Label>
          <div className="flex gap-2">
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. BC7K2Q"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              className="h-11 font-mono text-base tracking-wider uppercase"
            />
            <Button type="button" variant="outline" size="icon" className="size-11" onClick={pasteFromClipboard} aria-label="Paste code">
              <ClipboardPaste />
            </Button>
          </div>
        </div>

        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending || !code.trim() || !bookmaker}>
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
          {pending ? "Loading…" : "Load slip"}
        </Button>
      </form>

      {error && errorUi && (
        <Alert variant={error.code === "INVALID_CODE" || error.code === "EXPIRED_CODE" ? "destructive" : "default"} role="alert">
          <errorUi.icon />
          <AlertTitle>{errorUi.title}</AlertTitle>
          <AlertDescription>
            <p>{error.message}</p>
            {errorUi.retry && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => load()}>
                <RotateCw data-icon="inline-start" /> Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {pending ? <SlipSkeleton /> : slip ? <SlipView slip={slip} /> : null}

      <RecentSlips slips={recent} activeId={slip?.id} onOpen={openRecent} />
    </div>
  );
}

function SlipSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading slip">
      <Skeleton className="h-36 w-full rounded-xl" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}
