import { env } from "@/lib/env";
import { acceptedAudiences } from "@/lib/identity/google";
import { AdminSignInButton } from "./sign-in-button";

export const dynamic = "force-dynamic";

/**
 * Where an administrator signs in.
 *
 * Deliberately not a password form. There is no GameClaw password to type - administrators are
 * Google accounts whose role was granted out of band by `scripts/grant-admin.ts` - and a password
 * form here would be a second credential path into the most privileged part of the system.
 *
 * It says nothing about whether a visitor has an account, whether one exists, or whether it is
 * privileged. Every refusal looks the same from out here.
 */
export default function AdminSignIn() {
  // The first of the accepted audiences. The server may accept several so that installed apps
  // keep working across a client rotation, but a browser button is rendered for exactly one.
  const clientId = acceptedAudiences(env().GOOGLE_WEB_CLIENT_ID ?? "")[0] ?? "";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="font-semibold tracking-tight text-[#CCFF2E]">GameClaw</div>
        <h1 className="text-lg font-semibold">Administrator sign-in</h1>

        {clientId ? (
          <>
            <p className="text-sm text-zinc-400">
              Continue with the Google account that has been granted access.
            </p>
            <AdminSignInButton clientId={clientId} />
          </>
        ) : (
          <p className="text-sm text-zinc-400">
            Sign-in is not configured on this server. The Google Web client id is missing.
          </p>
        )}

        <p className="text-xs text-zinc-600">
          Access is decided by the account&apos;s role in the database, not by anything this page
          sends.
        </p>
      </div>
    </div>
  );
}
