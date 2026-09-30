"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps the Supabase session cookie fresh from the browser (the browser client refreshes the
 * access token before it expires and rewrites the cookie). Replaces session refresh in proxy.ts.
 */
export function SessionKeeper() {
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession();
    const onVisible = () => document.visibilityState === "visible" && void supabase.auth.getSession();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}
