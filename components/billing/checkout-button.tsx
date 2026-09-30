"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";

export function CheckoutButton({ plan, label, signedIn, highlight }: { plan: string; label: string; signedIn: boolean; highlight?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function buy() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    setPending(true);
    const res = await apiFetch<{ authorizationUrl: string }>("/api/v1/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
    if (!res.ok) {
      setPending(false);
      toast.error(res.error.message);
      return;
    }
    window.location.href = res.data.authorizationUrl; // Paystack checkout (mobile money or card)
  }

  return (
    <Button size="lg" className="h-11 w-full" variant={highlight ? "default" : "outline"} onClick={buy} disabled={pending}>
      {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
      {label}
    </Button>
  );
}
