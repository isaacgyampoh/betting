"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Google's own sign-in button, rendered by Google Identity Services.
 *
 * GIS hands the browser an ID token and nothing else - no access token, no secret, no redirect to
 * get wrong. The token goes to /api/v1/auth/admin-session, which verifies it server-side against
 * Google's published keys and then decides, from the database, whether this account is an
 * administrator. Nothing this component sends is trusted: it supplies a token, not a claim.
 *
 * Rendered by Google rather than drawn here on purpose. A button that says "Sign in with Google"
 * and is not Google's is the shape of a phishing page, and Google's own script is the only thing
 * that can produce the token anyway.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export function AdminSignInButton({ clientId }: { clientId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const gis = window.google?.accounts.id;
      if (!gis || !host.current) return;

      gis.initialize({
        client_id: clientId,
        callback: async (response) => {
          if (!response.credential) {
            setError("Google did not return a token.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/v1/auth/admin-session", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            if (res.ok) {
              // A full page load, not router.push(). The session is an httpOnly cookie the
              // server has just set, and every /admin page is server-rendered against it; a
              // client-side navigation can serve the router's cached copy of the guard's
              // redirect and bounce a signed-in administrator straight back here.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/admin");
              return;
            }
            const body = (await res.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(body?.error?.message ?? "That account cannot open this area.");
          } catch {
            setError("Could not reach the server. Please try again.");
          } finally {
            setBusy(false);
          }
        },
        auto_select: false,
      });

      gis.renderButton(host.current, {
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 280,
      });
    };
    script.onerror = () => setError("Could not load Google sign-in.");
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [clientId]);

  return (
    <div className="space-y-3">
      <div ref={host} className="flex justify-center" aria-busy={busy} />
      {busy && <p className="text-xs text-zinc-500">Signing in…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
