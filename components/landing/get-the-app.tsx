import Link from "next/link";
import { Apple, ArrowRight, Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { androidRelease } from "@/lib/release";

/**
 * How a visitor gets GameClaw.
 *
 * Android is the product; the browser version is the fallback for everyone else. That ordering is
 * the point of the component - the site used to lead with "Open app", which opened the web build,
 * and a visitor on a phone never learned there was a real one.
 *
 * What it will not do is invent a destination. Until a Play listing exists the page says the app
 * is not out yet and offers the browser instead. A store button that 404s is worse than no store
 * button, and it is the easiest possible thing to add "for now" and then ship.
 */
export function GetTheApp() {
  const release = androidRelease();

  return (
    <div className="space-y-3">
      <div className="flex flex-col justify-center gap-2 sm:flex-row lg:justify-start">
        {release.kind === "play" && (
          <Button asChild size="lg" className="h-12 px-6">
            <a href={release.url} rel="noreferrer">
              Get it on Google Play <ArrowRight data-icon="inline-end" />
            </a>
          </Button>
        )}

        {release.kind === "testing" && (
          <Button asChild size="lg" className="h-12 px-6">
            <a href={release.url} rel="noreferrer">
              <Download data-icon="inline-start" /> Download the test build
            </a>
          </Button>
        )}

        {release.kind === "unreleased" && (
          /* Deliberately not a link. There is nowhere honest for it to go yet. */
          <div className="flex h-12 items-center justify-center gap-2 rounded-md border border-dashed px-6 text-sm text-muted-foreground">
            <Smartphone className="size-4" aria-hidden />
            Android app coming to Google Play
          </div>
        )}

        <Button asChild size="lg" variant="outline" className="h-12 px-6">
          <Link href="/chat">Use it in your browser</Link>
        </Button>
      </div>

      {release.kind === "testing" && (
        <p className="text-xs text-muted-foreground">
          A test build, not the Play listing. Android will warn you about installing it, which is
          Android doing its job.
        </p>
      )}

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground lg:justify-start">
        <Apple className="size-3.5" aria-hidden />
        {/* "Coming soon" about work nobody has started becomes a year old without anyone noticing. */}
        iPhone isn&apos;t built yet. The browser version works on iOS today.
      </p>
    </div>
  );
}
