"use client";

import { useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiError } from "@/lib/api-client";
import { formatOdds } from "@/lib/format";
import type { SlipView as Slip } from "@/lib/slips/view";
import { ApiErrorAlert } from "./api-error-alert";
import { AUTO, BookmakerPicker, type BookmakerOption } from "./bookmaker-picker";
import { SlipView } from "./slip-view";
import { CodeInput, SlipSkeleton } from "./slip-workspace";

type ConvertBookmaker = BookmakerOption & { canLoad: boolean; canBook: boolean };

export function ConvertWorkspace({ bookmakers, source }: { bookmakers: ConvertBookmaker[]; source: Slip | null }) {
  const [useSource, setUseSource] = useState(source !== null);
  const [from, setFrom] = useState(source?.bookmaker.slug ?? AUTO);
  const [code, setCode] = useState("");
  // Converting *to* a bookmaker needs us to be able to book there.
  const targets = bookmakers.map((b) => ({ ...b, available: b.canBook }));
  const sources = bookmakers.map((b) => ({ ...b, available: b.canLoad }));
  const firstOther = (slug: string) => targets.find((b) => b.slug !== slug && b.canBook)?.slug ?? "";
  const [to, setTo] = useState(firstOther(source?.bookmaker.slug ?? "sportybet"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [results, setResults] = useState<Slip[]>([]);

  const fromSlug = useSource && source ? source.bookmaker.slug : from;

  function pickFrom(slug: string) {
    setFrom(slug);
    if (slug === to) setTo(firstOther(slug));
  }

  async function convert(e?: React.FormEvent, fromOverride?: string) {
    e?.preventDefault();
    setPending(true);
    setError(null);
    const fromChoice = fromOverride ?? from;
    const body =
      useSource && source
        ? { slipId: source.id, target: to }
        : { code, target: to, ...(fromChoice !== AUTO ? { bookmaker: fromChoice } : {}) };
    const res = await apiFetch<Slip>("/api/v1/slips/convert", { method: "POST", body: JSON.stringify(body) });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setResults([res.data]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const canSubmit = !!to && to !== fromSlug && (useSource ? !!source : !!code.trim());

  return (
    <div className="space-y-6">
      <form onSubmit={convert} className="space-y-4 rounded-lg border bg-card p-4">
        {useSource && source ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">From</p>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm">{source.bookmaker.name}</p>
                <p className="font-mono font-semibold tracking-wider">{source.code ?? "Edited slip"}</p>
                <p className="text-xs text-muted-foreground">{source.selectionCount} games</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{formatOdds(source.totalOdds)}</p>
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setUseSource(false)}>
                  Use another code
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <BookmakerPicker label="From" options={sources} value={from} onChange={pickFrom} withAuto />
            <CodeInput value={code} onChange={setCode} />
          </>
        )}

        <div className="flex justify-center text-muted-foreground">
          <ArrowDown className="size-5" />
        </div>

        <BookmakerPicker label="To" options={targets} value={to} onChange={setTo} disabledSlug={fromSlug} />

        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending || !canSubmit}>
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {pending ? "Converting…" : "Convert"}
        </Button>
      </form>

      {error && (
        <ApiErrorAlert
          error={error}
          onRetry={() => convert()}
          onChooseBookmaker={(slug) => {
            pickFrom(slug);
            void convert(undefined, slug);
          }}
        />
      )}

      {pending ? (
        <SlipSkeleton label="Matching games and booking the new code" />
      ) : (
        results.map((s, i) => (
          <SlipView key={s.id} slip={s} title={i === 0 ? `New ${s.bookmaker.name} slip` : `Slip ${i + 1}`} onEdited={setResults} />
        ))
      )}
    </div>
  );
}
