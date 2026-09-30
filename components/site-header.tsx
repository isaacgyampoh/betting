import Link from "next/link";
import { Logo } from "@/components/logo";
import { DesktopNav } from "@/components/desktop-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getAuthUser } from "@/lib/auth";

export async function SiteHeader() {
  const user = await getAuthUser();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="gameclaw home">
          <Logo />
        </Link>
        <DesktopNav />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link href="/account">Account</Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
