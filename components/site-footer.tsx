import Link from "next/link";

const LINKS = [
  { href: "/track-record", label: "Track record" },
  { href: "/pricing", label: "Pricing" },
  { href: "/responsible-gambling", label: "Responsible gambling" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

/**
 * `compact` is the one used inside the app.
 *
 * The full paragraph is for someone deciding whether to use this. Inside the app it was four lines
 * of grey boilerplate on every screen, directly above the bottom bar - about a seventh of a phone
 * given to something the reader accepted at sign-up and has a tab for. The links stay, because
 * responsible gambling has to be one tap from anywhere, and the composer already carries the line
 * about replies being AI-generated where it is actually relevant.
 */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <footer className="border-t pb-24 md:pb-6">
        <nav
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted-foreground"
          aria-label="Legal"
        >
          <span className="font-medium text-foreground">18+</span>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </footer>
    );
  }

  return (
    <footer className="border-t pb-24 md:pb-6">
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">18+ only.</strong> gameclaw is an information tool, not a
          bookmaker. Odds and stats come from third parties and may change. Analysis and chat replies (AI-generated) are
          not guaranteed. Bet only what you can afford to lose.
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
