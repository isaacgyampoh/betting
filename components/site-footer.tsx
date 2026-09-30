import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t pb-24 md:pb-6">
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">18+ only.</strong> gameclaw is an information tool, not a
          bookmaker. Odds and stats come from third parties and may change. Analysis and chat replies (AI-generated) are
          not guaranteed. Bet only what you can afford to lose.
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal">
          <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/responsible-gambling" className="hover:text-foreground">Responsible gambling</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
