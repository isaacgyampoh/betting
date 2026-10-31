import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { IOS_STATUS, androidRelease } from "@/lib/release";

export const metadata: Metadata = { title: "Sign in" };

/**
 * There is no sign-in on the website, and this page says so rather than pretending otherwise.
 *
 * It was a Supabase email-and-Google form until this commit. That project has been deleted, so the
 * form could not sign anybody in: it took an address, posted it to a hostname that no longer
 * resolves, and left the visitor on a spinner. Whoever found it spent their one attempt on a dead
 * end.
 *
 * Deleting the route was the other option and is worse. `requireAdultPage` and
 * `requireAccountPage` in lib/auth-pages.ts both redirect here, and so does the checkout button,
 * so removing the page would turn a broken form into a 404 at the end of a redirect. A page that
 * explains itself is a better destination, and it needs no client JavaScript and no auth provider.
 *
 * Accounts live in the app, where sign-in is Google or Apple verified against /api/v1/auth/*.
 * Nothing on the website needs one: the scores, fixtures, track record and pricing are all public.
 */
export default function LoginPage() {
  const release = androidRelease();

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in on the app</h1>
        <p className="text-sm text-muted-foreground">
          GameClaw accounts live in the mobile app. Signing in there uses your Google or Apple
          account, so there is no password to remember.
        </p>
      </div>

      {release.kind !== "unreleased" && (
        <Button asChild className="w-full">
          <a href={release.url} rel="noreferrer">
            {release.kind === "play" ? "Get the app for Android" : "Get the Android test build"}
          </a>
        </Button>
      )}

      {IOS_STATUS === "in-development" && (
        <p className="text-xs text-muted-foreground">
          The iPhone app is still in development. There is no App Store release yet, and we would
          rather say so than take your email for one.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        You do not need an account to use the rest of this site.{" "}
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Scores and fixtures
        </Link>
        ,{" "}
        <Link href="/track-record" className="underline underline-offset-4 hover:text-foreground">
          the track record
        </Link>{" "}
        and{" "}
        <Link href="/pricing" className="underline underline-offset-4 hover:text-foreground">
          pricing
        </Link>{" "}
        are all open. If you need a hand, the{" "}
        <Link href="/support" className="underline underline-offset-4 hover:text-foreground">
          support page
        </Link>{" "}
        has a way to reach us.
      </p>
    </div>
  );
}
