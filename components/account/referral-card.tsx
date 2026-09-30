"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReferralCard({ code, joined, daysEarned, days }: { code: string; joined: number; daysEarned: number; days: number }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? `https://gameclaw.win/?ref=${code}` : `${window.location.origin}/?ref=${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Invite a friend and you both get {days} free days when they sign up and confirm their account.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 font-mono">{code}</code>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check data-icon="inline-start" className="text-win" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {joined} {joined === 1 ? "friend has" : "friends have"} joined · {daysEarned} free days earned
      </p>
    </div>
  );
}
