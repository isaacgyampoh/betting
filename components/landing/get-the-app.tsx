import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { androidRelease } from "@/lib/release";

/**
 * How a visitor gets GameClaw.
 *
 * gameclaw.win is a marketing site. It does not sign anybody in and it is not a way to use the
 * product - the app is the product - so nothing here offers a "use it in your browser" route. An
 * earlier version of this page did, and the button led to a sign-in the site no longer operates.
 *
 * That leaves one honest state while the app is unpublished: say so. It is rendered as a status
 * pill rather than a button, because a primary-looking control that cannot be pressed is worse
 * than no control - a visitor spends their one click on it and gets nothing.
 *
 * The moment `NEXT_PUBLIC_PLAY_URL` is set this becomes a real Play button with no code change,
 * and `NEXT_PUBLIC_APK_URL` covers the tester window in between. Nothing here invents a
 * destination: a store link for an app that has not been published 404s for everyone who taps it.
 */
export function GetTheApp({ align = "start" }: { align?: "start" | "center" }) {
  const release = androidRelease();
  const centred = align === "center";

  return (
    <div className={`space-y-3 ${centred ? "flex flex-col items-center" : ""}`}>
      <div className={`flex flex-col gap-2 sm:flex-row ${centred ? "items-center justify-center" : "items-start"}`}>
        {release.kind === "play" && (
          <Button asChild size="lg" className="h-12 px-7 text-base">
            <a href={release.url} rel="noreferrer">
              Get it on Google Play <ArrowRight data-icon="inline-end" />
            </a>
          </Button>
        )}

        {release.kind === "testing" && (
          <Button asChild size="lg" className="h-12 px-7 text-base">
            <a href={release.url} rel="noreferrer">
              <Download data-icon="inline-start" /> Download the test build
            </a>
          </Button>
        )}

        {release.kind === "unreleased" && (
          /* Deliberately not a link or a button. There is nowhere honest for it to go yet. */
          <p className="inline-flex h-12 items-center gap-2.5 rounded-full border border-primary/35 bg-primary/10 px-5 text-sm font-medium text-foreground">
            <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden />
            Coming to Google Play
          </p>
        )}
      </div>

      {release.kind === "testing" && (
        <p className={`text-xs text-muted-foreground ${centred ? "text-center" : ""}`}>
          A test build, not the Play listing. Android will warn you about installing it, which is
          Android doing its job.
        </p>
      )}

      {release.kind === "unreleased" && (
        <p className={`text-xs text-muted-foreground ${centred ? "text-center" : ""}`}>
          {/* No date. "Coming soon" about work nobody has scheduled becomes a year old without
              anyone noticing, and a promised week that slips is worse than no week at all. */}
          Android first. iPhone isn&apos;t built yet.
        </p>
      )}
    </div>
  );
}
