import Link from "next/link";
import { AuthButton } from "@/components/auth-button";
import { DesktopNav } from "@/components/desktop-nav";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="gameclaw home">
          <Logo />
        </Link>
        <DesktopNav />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
