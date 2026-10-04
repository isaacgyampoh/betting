import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BottomNav } from "@/components/bottom-nav";
import { SetupBanner } from "@/components/setup-banner";
import { SessionKeeper } from "@/components/session-keeper";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <SetupBanner />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <SiteFooter compact />
      <BottomNav />
      {/* Only the signed-in app needs a live Supabase session; keeping this out of the root layout
          keeps its client off every marketing page. */}
      <SessionKeeper />
    </>
  );
}
