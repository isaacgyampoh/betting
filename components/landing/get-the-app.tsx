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
/**
 * The Google Play mark, drawn rather than fetched.
 *
 * Deliberately *not* a replica of the official "Get it on Google Play" badge. That badge means
 * "this is on the store, press here", and Google's brand terms do not allow it to be altered -
 * so a version reading "Coming soon" would be both a misuse of their asset and a promise the app
 * cannot keep. This is the product mark used nominatively, next to our own words, which is what
 * an announcement is allowed to do. It becomes the real badge on the day there is a listing.
 */
function GooglePlayMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <defs>
        <linearGradient id="gp-spine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00C3FF" />
          <stop offset="1" stopColor="#00E676" />
        </linearGradient>
      </defs>
      {/* The folded spine, blue at the top running to green at the foot. */}
      <path d="M3 2 L13.8 12 L3 22 Z" fill="url(#gp-spine)" />
      {/* Upper wing, lower wing, and the tip where the two meet. */}
      <path d="M3 2 L17.1 8.7 L13.8 12 Z" fill="#FFCE00" />
      <path d="M3 22 L13.8 12 L17.1 15.3 Z" fill="#FF3A44" />
      <path d="M17.1 8.7 L20.6 12 L17.1 15.3 L13.8 12 Z" fill="#FF8E00" />
    </svg>
  );
}

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
          /* Deliberately not a link or a button: there is nowhere honest for it to go yet, and a
             control that cannot be pressed spends the visitor's one click on nothing. */
          <p className="inline-flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
            <GooglePlayMark className="size-7 shrink-0 sm:size-8" />
            <span className="flex flex-col text-left">
              <span className="text-[0.68rem] tracking-[0.14em] text-muted-foreground uppercase">
                Coming soon on
              </span>
              <span className="text-base leading-tight font-semibold sm:text-lg">Google Play</span>
            </span>
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
