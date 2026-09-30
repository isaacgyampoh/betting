"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function AgeConfirmForm({ next }: { next: string }) {
  const router = useRouter();
  const [over18, setOver18] = useState(false);
  const [terms, setTerms] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch("/api/v1/me/age-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmedOver18: over18, acceptedTerms: terms }),
    });
    if (!res.ok) {
      setPending(false);
      const body = await res.json().catch(() => null);
      toast.error(body?.error?.message ?? "Could not save. Please try again.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>One quick check</CardTitle>
        <CardDescription>gameclaw deals with sports betting, so it&apos;s for adults only.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox id="over18" checked={over18} onCheckedChange={(v) => setOver18(v === true)} />
            <Label htmlFor="over18" className="leading-snug font-normal">
              I confirm I am 18 years or older.
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="terms" checked={terms} onCheckedChange={(v) => setTerms(v === true)} />
            <Label htmlFor="terms" className="leading-snug font-normal">
              <span>
                I accept the <Link href="/terms" className="underline">Terms</Link> and understand that predictions
                are not guaranteed.
              </span>
            </Label>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={!over18 || !terms || pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Continue
          </Button>
          <p className="text-xs text-muted-foreground">
            Gambling can be addictive. See our <Link href="/responsible-gambling" className="underline">responsible gambling</Link> page for help.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
