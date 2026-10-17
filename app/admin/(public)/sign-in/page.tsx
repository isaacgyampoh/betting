export const dynamic = "force-dynamic";

/**
 * Where a non-admin lands.
 *
 * Deliberately not a login form. There is no password to type - administrators sign in through
 * the app with Google, and the role is granted out of band with scripts/grant-admin.ts. A form
 * here would be a second credential path into the most privileged part of the system, and the
 * one place worth having fewer of those is this one.
 *
 * It says nothing about whether the visitor has an account, whether that account exists, or
 * whether it is privileged.
 */
export default function AdminSignIn() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="max-w-sm space-y-3 text-center">
        <div className="font-semibold tracking-tight text-[#CCFF2E]">GameClaw</div>
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="text-sm text-zinc-400">
          This area needs an administrator account. Sign in through the GameClaw app with an
          address that has been granted access.
        </p>
      </div>
    </div>
  );
}
