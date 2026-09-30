"use client";

import { useMemo, useState } from "react";
import { Loader2, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api-client";
import { applyEdit, type EditOp } from "@/lib/slips/edit";
import { formatOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SlipView } from "@/lib/slips/view";
import { ApiErrorAlert } from "./api-error-alert";

type Tool = "remove" | "safest" | "trim" | "split";

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "remove", label: "Remove", hint: "Tap games below to remove them." },
  { id: "safest", label: "Safest N", hint: "Keep the picks with the lowest odds." },
  { id: "trim", label: "Trim odds", hint: "Drop the riskiest picks until total odds fit your target." },
  { id: "split", label: "Split", hint: "Split into smaller slips with balanced odds." },
];

function Stepper({ value, min, max, onChange, id }: { value: number; min: number; max: number; onChange: (n: number) => void; id: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="icon" className="size-10" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">
        <Minus />
      </Button>
      <output id={id} className="w-10 text-center font-mono text-lg font-semibold tabular-nums">{value}</output>
      <Button type="button" variant="outline" size="icon" className="size-10" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">
        <Plus />
      </Button>
    </div>
  );
}

export function EditPanel({
  slip,
  removeSelection,
  onClose,
  onDone,
}: {
  slip: SlipView;
  removeSelection: Set<number>;
  onClose: () => void;
  onDone: (slips: SlipView[]) => void;
}) {
  const bookable = slip.selections.filter((s) => s.status === "OK" && s.market && !s.started);
  const items = bookable.map((s) => ({ position: s.position, odds: s.odds }));
  const excluded = slip.selections.filter((s) => s.status === "OK").length - bookable.length;

  const [tool, setTool] = useState<Tool>("safest");
  const [count, setCount] = useState(Math.max(1, Math.min(3, items.length - 1)));
  const [target, setTarget] = useState("10");
  const [parts, setParts] = useState(2);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const op: EditOp | null = useMemo(() => {
    if (tool === "remove") return removeSelection.size ? { type: "remove", positions: [...removeSelection] } : null;
    if (tool === "safest") return { type: "safest", count };
    if (tool === "trim") {
      const t = Number(target);
      return Number.isFinite(t) && t >= 1.01 ? { type: "trim", targetOdds: t } : null;
    }
    return { type: "split", parts };
  }, [tool, removeSelection, count, target, parts]);

  const preview = op ? applyEdit(items, op) : null;
  const empty = !preview || preview.groups.every((g) => g.length === 0);

  async function apply() {
    if (!op) return;
    setPending(true);
    setError(null);
    const res = await apiFetch<SlipView[]>(`/api/v1/slips/${slip.id}/edit`, { method: "POST", body: JSON.stringify({ op, book: true }) });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone(res.data);
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Edit slip</h3>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close editor">
          <X />
        </Button>
      </div>

      <div role="tablist" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tool === t.id}
            onClick={() => setTool(t.id)}
            className={cn("rounded-md py-2 text-xs font-medium", tool === t.id ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{TOOLS.find((t) => t.id === tool)!.hint}</p>

      {tool === "remove" && <p className="text-sm">{removeSelection.size} selected</p>}
      {tool === "safest" && (
        <div className="flex items-center justify-between">
          <Label htmlFor="safest-n">Games to keep</Label>
          <Stepper id="safest-n" value={count} min={1} max={Math.max(1, items.length)} onChange={setCount} />
        </div>
      )}
      {tool === "trim" && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="target-odds">Target total odds</Label>
          <Input id="target-odds" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(",", "."))} className="h-10 w-28 text-right font-mono" />
        </div>
      )}
      {tool === "split" && (
        <div className="flex items-center justify-between">
          <Label htmlFor="split-n">Number of slips</Label>
          <Stepper id="split-n" value={parts} min={2} max={Math.max(2, Math.min(10, items.length))} onChange={setParts} />
        </div>
      )}

      {preview && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          {preview.groups.map((g, i) => (
            <p key={i} className="flex justify-between">
              <span>
                {preview.groups.length > 1 ? `Slip ${i + 1}: ` : "Result: "}
                {g.length} {g.length === 1 ? "game" : "games"} {g.length > 0 && <span className="text-muted-foreground">(#{g.join(", #")})</span>}
              </span>
              <span className="font-mono font-semibold">{formatOdds(preview.totals[i])}</span>
            </p>
          ))}
        </div>
      )}
      {excluded > 0 && (
        <p className="text-xs text-muted-foreground">
          {excluded} started or unsupported {excluded === 1 ? "game is" : "games are"} left out; they can&apos;t be booked.
        </p>
      )}

      {error && <ApiErrorAlert error={error} onRetry={apply} />}

      <Button size="lg" className="h-11 w-full" disabled={!op || empty || pending} onClick={apply}>
        {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
        {preview && preview.groups.length > 1 ? `Create ${preview.groups.length} codes` : "Create new code"}
      </Button>
    </div>
  );
}
