"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/slips/api-error-alert";
import { RichText } from "@/components/chat/rich-text";
import { apiFetch, type ApiError } from "@/lib/api-client";

export function AnalysisPanel({ matchId }: { matchId: number }) {
  const [pending, setPending] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const res = await apiFetch<{ analysis: string }>(`/api/v1/matches/${matchId}/analysis`, { method: "POST" });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setText(res.data.analysis);
  }

  if (text) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" /> AI analysis
        </p>
        <RichText text={text} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button size="lg" className="h-11 w-full" onClick={run} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
        {pending ? "Analysing the numbers…" : "Deep AI analysis"}
      </Button>
      {error && <ApiErrorAlert error={error} onRetry={run} />}
    </div>
  );
}
