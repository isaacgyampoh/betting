import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdultPage } from "@/lib/auth-pages";
import { getMe } from "@/lib/services/profile";
import { getAiAllowance } from "@/lib/services/ai-quota";
import { listPayments } from "@/lib/services/billing";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { user } = await requireAdultPage("/account");
  const [me, ai, payments] = await Promise.all([getMe(user), getAiAllowance(user.id), listPayments(user)]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle>{me.displayName ?? me.email}</CardTitle>
          {me.displayName && <CardDescription>{me.email}</CardDescription>}
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Plan
            <Badge variant={me.subscription ? "default" : "secondary"}>{me.subscription?.planName ?? "Free"}</Badge>
          </CardTitle>
          <CardDescription>
            {me.subscription
              ? `Active until ${me.subscription.endsAt?.toLocaleDateString("en-GH")} · ${ai.remaining} AI requests left today`
              : `${me.freeAiCredits} free AI requests left. Slip tools are always free.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" variant={me.subscription ? "outline" : "default"}>
            <Link href="/pricing">{me.subscription ? "Extend or change plan" : "See plans"}</Link>
          </Button>
        </CardContent>
      </Card>
      {payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {payments.map((p) => (
                <li key={p.reference} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {p.plan} · {new Date(p.createdAt).toLocaleDateString("en-GH")}
                    {p.channel && <span className="text-muted-foreground"> · {p.channel.replace("_", " ")}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    GHS {p.amountGhs.toFixed(2)}
                    <Badge variant={p.status === "SUCCESS" ? "default" : "secondary"}>{p.status.toLowerCase()}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" size="lg">
            <Link href="/responsible-gambling">Responsible gambling</Link>
          </Button>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="destructive" size="lg" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
