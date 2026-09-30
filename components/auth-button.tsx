"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Header sign-in state, resolved in the browser so public pages can be served statically. */
export function AuthButton() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => data.subscription.unsubscribe();
  }, []);

  if (signedIn === null) return <span className="w-16" aria-hidden />;
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
