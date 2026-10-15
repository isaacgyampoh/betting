"use client";

import { useState } from "react";
import { Check, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { shareNatively } from "@/components/native-bridge";

// Sharing a slip the way a phone shares anything else: the system sheet, straight into WhatsApp.
//
// The old behaviour opened the slip image in a new tab and left the person to work it out. On a
// phone that is not sharing, it is a detour. Where the browser can share a file we hand it the
// image itself; otherwise we fall back, in order, to sharing the link, then copying it.

type Props = {
  slipId: string;
  code: string | null;
  bookmaker: string;
  totalOdds: number | null;
  games: number;
  className?: string;
  /** Compact form for the chat card. */
  compact?: boolean;
};

function shareText({ code, bookmaker, totalOdds, games }: Pick<Props, "code" | "bookmaker" | "totalOdds" | "games">) {
  const odds = totalOdds ? ` at ${totalOdds.toFixed(2)}` : "";
  const head = code ? `${bookmaker} code ${code}` : `${bookmaker} slip`;
  return `${head} — ${games} game${games === 1 ? "" : "s"}${odds}. Built with gameclaw.`;
}

export function ShareSlip({ slipId, code, bookmaker, totalOdds, games, className, compact }: Props) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");

  async function share() {
    if (state === "working") return;
    setState("working");
    const text = shareText({ code, bookmaker, totalOdds, games });
    const url = `${location.origin}/slip/${slipId}/share`;

    try {
      // Best case: the image itself goes into the share sheet.
      if (typeof navigator.canShare === "function") {
        const res = await fetch(url);
        if (res.ok) {
          const file = new File([await res.blob()], `${code ?? "slip"}.png`, { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text });
            setState("idle");
            return;
          }
        }
      }
      // Inside the Android shell the system sheet is the one the rest of the phone uses, and it
      // reaches WhatsApp where the webview's own is patchy. It only handles text and a link, so
      // it comes after the attempt to share the image itself.
      if (await shareNatively({ title: "GameClaw slip", text, url })) {
        setState("idle");
        return;
      }
      if (typeof navigator.share === "function") {
        await navigator.share({ text, url });
        setState("idle");
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast.success("Copied, ready to paste");
      setState("done");
      setTimeout(() => setState("idle"), 1600);
    } catch (error) {
      // Dismissing the share sheet throws AbortError; that is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") {
        setState("idle");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setState("idle");
    }
  }

  const Icon = state === "working" ? Loader2 : state === "done" ? Check : Share2;
  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share this slip"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-medium text-primary transition-colors hover:underline disabled:opacity-60",
        compact ? "text-xs" : "text-sm",
        className,
      )}
      disabled={state === "working"}
    >
      <Icon className={cn(compact ? "size-3.5" : "size-4", state === "working" && "animate-spin")} aria-hidden />
      {state === "done" ? "Copied" : "Share"}
    </button>
  );
}
