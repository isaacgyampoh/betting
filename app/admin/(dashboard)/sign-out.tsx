"use client";

/**
 * Ends the browser session.
 *
 * The cookie is httpOnly, so script cannot clear it - only the server can, which is the point.
 * This asks it to, then reloads so the guard sees a request with no session.
 */
export function AdminSignOut() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/v1/auth/admin-session", { method: "DELETE" });
        // Full load, as on the way in: the guard is server-side and a cached client route
        // would render the signed-in shell for a session that no longer exists.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/admin/sign-in");
      }}
      className="rounded px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
    >
      Sign out
    </button>
  );
}
