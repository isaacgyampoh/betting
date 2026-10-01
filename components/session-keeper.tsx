"use client";

import { useEffect } from "react";

/**
 * Keeps the Supabase session cookie fresh from the browser.
 *
 * The Supabase client is ~250 KB, and this runs on every page, so it is imported lazily once the
 * page is idle. Nothing here is needed for first paint: a session that is about to expire is still
 * refreshed well before the user needs it.
 */
export function SessionKeeper() {
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;

    const start = async () => {
      const { createClient } = await import("@/lib/supabase/client");
      if (cancelled) return;
      const supabase = createClient();
      void supabase.auth.getSession();
      const onVisible = () => document.visibilityState === "visible" && void supabase.auth.getSession();
      document.addEventListener("visibilitychange", onVisible);
      detach = () => document.removeEventListener("visibilitychange", onVisible);
    };

    // Wait for idle so the session check never competes with rendering the page.
    const ric = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback : null;
    const handle = ric ? ric(() => void start(), { timeout: 3000 }) : window.setTimeout(() => void start(), 1200);

    return () => {
      cancelled = true;
      detach?.();
      if (ric) window.cancelIdleCallback(handle as number);
      else clearTimeout(handle as number);
    };
  }, []);
  return null;
}
