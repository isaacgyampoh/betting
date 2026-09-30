"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

type Settings = { spendNoteGhs: number | null; remindersOn: boolean; excludedUntil: string | null };

const BREAK_OPTIONS = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "1 week" },
  { days: 30, label: "30 days" },
  { days: 180, label: "6 months" },
];

export function ResponsibleTools({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [note, setNote] = useState(initial.spendNoteGhs?.toString() ?? "");
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function save(body: Record<string, unknown>, key: string) {
    setPending(key);
    const res = await apiFetch<Settings>("/api/v1/me/responsible", { method: "POST", body: JSON.stringify(body) });
    setPending(null);
    if (!res.ok) return toast.error(res.error.message);
    setSettings(res.data);
    return res.data;
  }

  if (settings.excludedUntil && new Date(settings.excludedUntil) > new Date()) {
    return (
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">You&apos;re taking a break</p>
        <p className="text-muted-foreground">
          Betting features are switched off until {new Date(settings.excludedUntil).toLocaleDateString("en-GH")}. This can&apos;t be shortened. Support and
          helplines are on our <a href="/responsible-gambling" className="text-primary underline">responsible gambling</a> page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <Label htmlFor="spend-note">What you plan to spend (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="spend-note"
            inputMode="decimal"
            placeholder="e.g. 50"
            value={note}
            onChange={(e) => setNote(e.target.value.replace(/[^\d.]/g, ""))}
            className="h-10"
          />
          <Button
            variant="outline"
            className="h-10"
            disabled={pending === "note"}
            onClick={() => save({ spendNoteGhs: note === "" ? null : Number(note) }, "note").then((s) => s && toast.success("Saved"))}
          >
            {pending === "note" && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A note to yourself in GHS. We show it back to you; we can&apos;t see or limit what you spend with a bookmaker.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Daily reminder</p>
          <p className="text-xs text-muted-foreground">A once-a-day nudge to check in on your time and spending.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending === "reminders"}
          onClick={() => save({ remindersOn: !settings.remindersOn }, "reminders")}
        >
          {settings.remindersOn ? "On" : "Off"}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Take a break</p>
        <p className="text-xs text-muted-foreground">
          Switches off slips, chat and picks for the period you choose. It can be extended but never shortened.
        </p>
        <div className="flex flex-wrap gap-2">
          {BREAK_OPTIONS.map((o) => (
            <Button
              key={o.days}
              variant={confirming === o.days ? "destructive" : "outline"}
              size="sm"
              disabled={pending === "break"}
              onClick={() => {
                if (confirming !== o.days) return setConfirming(o.days);
                void save({ excludeDays: o.days }, "break");
              }}
            >
              {confirming === o.days ? `Confirm ${o.label}` : o.label}
            </Button>
          ))}
        </div>
        {confirming !== null && <p className="text-xs text-loss">Tap again to confirm. This can&apos;t be undone.</p>}
      </div>
    </div>
  );
}
