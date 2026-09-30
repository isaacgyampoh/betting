import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAdultPage } from "@/lib/auth-pages";
import { AppError } from "@/lib/errors";
import { formatKickoff } from "@/lib/format";
import { verifyAndFulfil, type FulfilResult } from "@/lib/services/billing";

export const metadata: Metadata = { title: "Payment" };

// Paystack redirects here with ?reference=... after checkout.
export default async function BillingCallbackPage({ searchParams }: PageProps<"/billing/callback">) {
  const params = await searchParams;
  const reference = typeof params.reference === "string" ? params.reference : typeof params.trxref === "string" ? params.trxref : null;
  const { user } = await requireAdultPage(`/billing/callback?reference=${reference ?? ""}`);

  let result: FulfilResult = { status: "failed" };
  if (reference) {
    try {
      result = await verifyAndFulfil(user, reference);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }

  const ok = result.status === "activated" || result.status === "already_processed";
  const Icon = ok ? CheckCircle2 : result.status === "pending" ? Clock : XCircle;
  return (
    <div className="mx-auto max-w-sm space-y-4 py-8 text-center">
      <Icon className={ok ? "mx-auto size-12 text-primary" : "mx-auto size-12 text-muted-foreground"} />
      <h1 className="text-xl font-semibold">
        {ok ? "You're all set" : result.status === "pending" ? "Payment processing" : "Payment not completed"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {ok
          ? `Your plan is active${result.endsAt ? ` until ${formatKickoff(result.endsAt.toISOString())}` : ""}.`
          : result.status === "pending"
            ? "Mobile money can take a minute. We'll activate your plan as soon as Paystack confirms it; refresh this page shortly."
            : "No money was taken, or the payment was declined. You can try again."}
      </p>
      <Button asChild size="lg" className="h-11 w-full">
        <Link href={ok ? "/chat" : "/pricing"}>{ok ? "Start chatting" : "Back to plans"}</Link>
      </Button>
    </div>
  );
}
