"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/slips/api-error-alert";
import { apiFetch, type ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SlipView } from "@/lib/slips/view";
import type { ReadSlip } from "@/lib/services/read-slip";
import { RichText } from "./rich-text";
import { ChatSlipCard } from "./slip-card";
import { ReadSlipConfirm } from "./read-slip-confirm";

type Allowance = { kind: "plan" | "trial"; remaining: number; plan: { name: string } | null; allowDeepAnalysis: boolean };
type QuickReply = { label: string; message: string };
type Turn = { role: "user" | "assistant"; content: string; slips?: SlipView[]; read?: ReadSlip };
type ChatResponse = { reply: string; slips: SlipView[]; allowance: Allowance; quickReplies: QuickReply[] };

const STORAGE_KEY = "gameclaw.chat.v2";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Things that work without the user already having a code. Sample codes are deliberately not
// suggested: they don't resolve in production, so suggesting one would send the user into an error.
const STARTERS = [
  "Build me a 5 odds for today",
  "Give me a 2 odds with varied markets",
  "Paste your booking code and I'll check it",
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
  const [input, setInput] = useState(matchId ? "What do the numbers say about this match?" : "");
  const [pending, setPending] = useState<null | "reply" | "upload">(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [allowance, setAllowance] = useState(initialAllowance);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setPending("reply");
    setError(null);
    setQuickReplies([]);
    const res = await apiFetch<ChatResponse>("/api/v1/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: next.filter((t) => t.content).map(({ role, content }) => ({ role, content: content.slice(0, 2000) })),
        matchId,
        seenSlipIds: [...new Set(next.flatMap((t) => t.slips?.map((s) => s.id) ?? []))],
      }),
    });
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      setTurns(turns);
      setInput(content);
      return;
    }
    setTurns([...next, { role: "assistant", content: res.data.reply, slips: res.data.slips }]);
    setAllowance(res.data.allowance);
    setQuickReplies(res.data.quickReplies ?? []);
  }

  async function upload(file: File) {
    if (pending) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError({ code: "BAD_REQUEST", message: "That file is too big. Please upload something under 4 MB." });
      return;
    }
    setPending("upload");
    setError(null);
    setQuickReplies([]);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/v1/slips/read", { method: "POST", body });
    const json = (await res.json().catch(() => null)) as { data?: ReadSlip; error?: ApiError } | null;
    setPending(null);
    if (!res.ok || !json?.data) {
      setError(json?.error ?? { code: "INTERNAL", message: "We couldn't read that file. Please try again." });
      return;
    }
    setTurns((t) => [...t, { role: "user", content: `Uploaded ${file.name}` }, { role: "assistant", content: "", read: json.data }]);
  }

  /** The user confirmed what we read: hand the rows to the assistant as text. */
  function confirmRead(read: ReadSlip) {
    const lines = read.rows
      .filter((r) => r.read.home && r.read.away)
      .map((r) => `${r.match?.home ?? r.read.home} v ${r.match?.away ?? r.read.away} — ${r.read.pick ?? r.read.market ?? "?"} @ ${r.read.odds ?? "?"}`);
    void send(`This is my slip, read from a screenshot:\n${lines.join("\n")}\n\nWhat do the numbers say about these games?`);
  }

  const busy = pending !== null;

  return (
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col">
      <div className="mb-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className={cn(allowance.remaining === 0 && "text-loss")}>
          {allowance.kind === "trial"
            ? `${allowance.remaining} free ${allowance.remaining === 1 ? "message" : "messages"} left`
            : `${allowance.plan?.name} · ${allowance.remaining} left today`}
        </span>
        {turns.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTurns([]);
              setQuickReplies([]);
            }}
          >
            <RotateCcw data-icon="inline-start" /> New chat
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-5">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste a booking code from any bookmaker, or upload a screenshot of a slip. Then ask for a conversion, a target odds, or the numbers behind
              it.
            </p>
            <div className="flex flex-col gap-1.5">
              {STARTERS.map((s) => (
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
              {t.content && <RichText text={t.content} />}
              {t.read && <ReadSlipConfirm read={t.read} onConfirm={() => confirmRead(t.read!)} />}
              {t.slips?.map((s) => (
                <ChatSlipCard key={s.id} slip={s} />
              ))}
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {pending === "upload" ? "Reading the slip…" : "Checking…"}
          </div>
        )}
        {error && <ApiErrorAlert error={error} onRetry={() => send(input)} />}
        <div ref={bottomRef} />
      </div>

      {quickReplies.length > 0 && !busy && (
        <div className="mt-4 flex flex-wrap gap-2">
          {quickReplies.map((q) => (
            <button key={q.label} onClick={() => send(q.message)} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-accent">
              {q.label}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-20 mt-3 flex items-end gap-1.5 rounded-lg border bg-card p-1.5 md:bottom-4"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Upload a slip screenshot"
        >
          <ImagePlus />
        </Button>
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
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
          aria-label="Message"
        />
        <Button type="submit" size="icon" className="size-10 shrink-0" disabled={busy || !input.trim()} aria-label="Send">
          <ArrowUp />
        </Button>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Replies are generated by AI from bookmaker and API-Football data, and can be wrong. Estimates, not guarantees. 18+.
      </p>
    </div>
  );
}
