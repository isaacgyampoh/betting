"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, ReceiptText, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/slips/api-error-alert";
import { apiFetch, type ApiError } from "@/lib/api-client";
import { formatOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SlipView } from "@/lib/slips/view";
import { RichText } from "./rich-text";

type Allowance = { kind: "plan" | "trial"; remaining: number; plan: { name: string } | null; allowDeepAnalysis: boolean };
type Turn = { role: "user" | "assistant"; content: string; slips?: SlipView[] };
type ChatResponse = { reply: string; slips: SlipView[]; allowance: Allowance };

const STORAGE_KEY = "gameclaw.chat.v1";

const SUGGESTIONS = [
  "Convert SportyBet BC7K2Q to Betway",
  "Load BC7K2Q on SportyBet and keep the 4 safest picks",
  "Convert BW5V8N to SportyBet and drop anything above 2.0",
  "Arsenal's next match: what does head-to-head say?",
];

function loadStored(): Turn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]).slice(-30) : [];
  } catch {
    return [];
  }
}

export function ChatWorkspace({ initialAllowance, matchId }: { initialAllowance: Allowance; matchId?: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState(matchId ? "What do the stats say about this match?" : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [allowance, setAllowance] = useState(initialAllowance);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore after mount (localStorage isn't available during SSR).
  useEffect(() => {
    const stored = loadStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from browser storage
    if (stored.length) setTurns(stored);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-30)));
    } catch {
      /* storage blocked; chat still works in memory */
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setInput("");
    setPending(true);
    setError(null);
    const res = await apiFetch<ChatResponse>("/api/v1/ai/chat", {
      method: "POST",
      body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content: content.slice(0, 2000) })), matchId }),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setTurns(turns); // drop the unsent message so it can be retried
      setInput(content);
      return;
    }
    setTurns([...next, { role: "assistant", content: res.data.reply, slips: res.data.slips }]);
    setAllowance(res.data.allowance);
  }

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <div className="mb-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className={cn(allowance.remaining === 0 && "text-loss")}>
          {allowance.kind === "trial"
            ? `${allowance.remaining} free ${allowance.remaining === 1 ? "message" : "messages"} left`
            : `${allowance.plan?.name} · ${allowance.remaining} left today`}
        </span>
        {turns.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setTurns([])}>
            <RotateCcw data-icon="inline-start" /> New chat
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-5">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Paste a booking code, or ask about a slip or a match. For example:</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg bg-secondary px-3.5 py-2.5 text-sm whitespace-pre-wrap">{t.content}</p>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              <RichText text={t.content} />
              {t.slips && t.slips.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                  {t.slips.map((s) => (
                    <li key={s.id}>
                      <Link href={`/slip?id=${s.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent">
                        <ReceiptText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-medium">{s.code ?? "No code"}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.bookmaker.name} · {s.selectionCount} {s.selectionCount === 1 ? "game" : "games"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold">{formatOdds(s.totalOdds)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        )}

        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking…
          </div>
        )}
        {error && <ApiErrorAlert error={error} onRetry={() => send(input)} />}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-20 mt-4 flex items-end gap-2 rounded-lg border bg-card p-1.5 md:bottom-4"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Paste a code or ask something"
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm outline-none"
          aria-label="Message"
        />
        <Button type="submit" size="icon" className="size-10" disabled={pending || !input.trim()} aria-label="Send">
          <ArrowUp />
        </Button>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Replies are generated by AI from bookmaker and API-Football data, and can be wrong. 18+.
      </p>
    </div>
  );
}
