import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/identity/admin";
import { AdminSignOut } from "./sign-out";

/**
 * The guard for every admin page.
 *
 * A layout wraps every route beneath it, so putting the check here means a new page under
 * /admin is protected the moment it exists rather than the moment somebody remembers to add a
 * guard to it. The individual server actions check again - defence in depth, and a layout cannot
 * protect a POST on its own.
 *
 * Its own route group, outside (marketing): nothing here shares a layout, a nav or a stylesheet
 * with gameclaw.win, so the marketing site cannot be changed by changing the dashboard.
 */
export const metadata: Metadata = {
  title: "GameClaw admin",
  // A private dashboard has no business in a search index.
  robots: { index: false, follow: false, nocache: true },
};

// Never prerendered or cached: every render depends on who is asking.
export const dynamic = "force-dynamic";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/sign-in");

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight text-[#CCFF2E]">GameClaw</span>
          <span className="text-xs uppercase tracking-widest text-zinc-500">admin</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="rounded px-2.5 py-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto truncate text-xs text-zinc-500">{admin.email}</span>
          <AdminSignOut />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
