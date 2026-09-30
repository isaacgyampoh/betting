"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/slips/api-error-alert";
import { RichText } from "@/components/chat/rich-text";
import { apiFetch, type ApiError } from "@/lib/api-client";

export function AnalysisPanel({ matchId, date }: { matchId: number; date?: string }) {
  const [pending, setPending] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const res = await apiFetch<{ analysis: string }>(`/api/v1/matches/${matchId}/analysis${date ? `?date=${date}` : ""}`, { method: "POST" });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setText(res.data.analysis);
  }

  if (text) {
    return (
      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">Analysis</h2>
          <span className="text-xs text-muted-foreground">From the numbers on this page. Not a prediction.</span>
        </div>
        <div className="p-4">
          <RichText text={text} />
        </div>
      </section>
    );
  }
  return (
    <div className="space-y-2">
      <Button variant="outline" size="lg" className="h-11 w-full" onClick={run} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileText data-icon="inline-start" />}
        {pending ? "Reading the numbers…" : "Match analysis"}
      </Button>
      {error && <ApiErrorAlert error={error} onRetry={run} />}
    </div>
  );
}
