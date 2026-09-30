import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/components/nav-items";

const FEATURES: Record<string, string> = {
  "/slip": "Paste a booking code and see every game, market and odd.",
  "/convert": "Move a slip from one bookmaker to another and get a new code.",
  "/matches": "Form, head-to-head and standings before you bet.",
  "/chat": "Ask in plain English: \"convert this to Betway and drop anything above 2.0\".",
};

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-4 pt-4">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Your betting slips, sorted.</h1>
        <p className="max-w-prose text-muted-foreground">
          Load, convert and trim booking codes across SportyBet and Betway, check the stats, and let the AI
          assistant do the busywork.
        </p>
        <Button asChild size="lg">
          <Link href="/slip">
            Load a booking code <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {NAV_ITEMS.filter((i) => i.href in FEATURES).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader>
                <Icon className="mb-2 size-6 text-primary" />
                <CardTitle>{label}</CardTitle>
                <CardDescription>{FEATURES[href]}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
