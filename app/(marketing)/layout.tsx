import type { Viewport } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { androidRelease } from "@/lib/release";

/**
 * Marketing shell: no app tab bar, one clear way into the app.
 *
 * `data-brand="dark"` is what switches the whole page onto the ink-and-lime palette - the selector
 * is in `globals.css` and matches on the html element, so the background reaches the edges of the
 * viewport rather than stopping at this div.
 *
 * There is no theme toggle here, and that is a constraint rather than an omission: the lime accent
 * is unreadable on a light background, so a light marketing surface would need a second accent
 * colour and would stop matching the app and the advertisement. The app shell keeps its toggle.
 */
/**
 * The marketing surface is ink whatever the phone is set to, so the browser chrome has to be too.
 *
 * The root layout varies theme-color with the colour scheme, which is right for the app. On a
 * phone in light mode that painted Chrome's toolbar and the status bar above it near-white,
 * directly over a black page - the first thing a visitor sees is a bright band that belongs to a
 * different site. A segment-level viewport overrides it for these routes only.
 */
export const viewport: Viewport = {
  themeColor: "#09090B",
};

const NAV = [
  { href: "/track-record", label: "Track record" },
  { href: "/pricing", label: "Pricing" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const release = androidRelease();

  return (
    <div data-brand="dark" className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" aria-label="gameclaw home">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <nav className="flex items-center gap-0.5 sm:mr-2 sm:gap-1" aria-label="Sections">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2.5 py-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-secondary hover:text-foreground sm:px-3"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {release.kind !== "unreleased" && (
              <Button asChild size="sm">
                <a href={release.url} rel="noreferrer">
                  {release.kind === "play" ? "Get the app" : "Get the test build"}
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
