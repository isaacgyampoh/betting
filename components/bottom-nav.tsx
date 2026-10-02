"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/nav-items";

/**
 * A tapped tab lights up at once, instead of waiting for the page to arrive.
 *
 * `usePathname` only changes after the navigation finishes, so on a phone the tab you just pressed
 * stayed grey for a second or more and the app felt like it had ignored you. `useLinkStatus` knows
 * the navigation is in flight, which is the bit a native app shows immediately.
 */
function TabContent({ icon: Icon, label, active }: { icon: typeof NAV_ITEMS[number]["icon"]; label: string; active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cn(
        "flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors",
        active || pending ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className={cn("size-5 transition-transform", pending && "scale-110")} />
      {label}
    </span>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main" data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link href={href} prefetch aria-current={active ? "page" : undefined} className="block">
                <TabContent icon={Icon} label={label} active={active} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
