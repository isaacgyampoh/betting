"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Header sign-in state, resolved in the browser so public pages stay static.
 * Supabase is imported lazily (it is ~250 KB) and never blocks first paint.
 */
export function AuthButton() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      if (cancelled) return;
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setSignedIn(!!data.session);
      const sub = supabase.auth.onAuthStateChange((_e, session) => {
        if (!cancelled) setSignedIn(!!session);
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Reserve the space so the header doesn't shift once the state resolves.
  if (signedIn === null) return <span className="inline-block w-16" aria-hidden />;

  return signedIn ? (
    <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Account">
      <Link href="/account">
        <UserRound />
      </Link>
    </Button>
  ) : (
    <Button asChild size="sm">
      <Link href="/login">Sign in</Link>
    </Button>
  );
}
