import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/identity/admin";
import { reactivateUser, suspendUser, userDetail } from "@/lib/services/admin";
import { Panel, Pill, Stat, When } from "../../_components";

export const dynamic = "force-dynamic";

/**
 * Suspending and reactivating, as server actions.
 *
 * Each calls requireAdmin itself. The layout already redirects a non-admin away from the page,
 * but a server action is a POST endpoint with its own URL: it can be invoked without ever
 * rendering the page that contains the button. Guarding the render is not guarding the action.
 *
 * The target comes from a hidden field, which is client-supplied and therefore not trusted for
 * anything but "which row" - authority comes from requireAdmin, and suspendUser re-reads the
 * target from the database before touching it.
 */
async function suspend(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "No reason given";
  await suspendUser(admin.id, id, reason);
  revalidatePath(`/admin/users/${id}`);
}

async function reactivate(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  await reactivateUser(admin.id, id);
  revalidatePath(`/admin/users/${id}`);
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { profile, sessions, recentSlips } = await userDetail(id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/users" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Users
        </Link>
        <h1 className="text-lg font-semibold">{profile.email ?? profile.displayName ?? profile.id}</h1>
        {profile.suspendedAt ? <Pill state="bad">suspended</Pill> : <Pill state="ok">active</Pill>}
        {profile.role === "ADMIN" && <Pill state="warn">admin</Pill>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Slips" value={profile._count.slips} />
        <Stat label="Payments" value={profile._count.payments} />
        <Stat label="Subscriptions" value={profile._count.subscriptions} />
        <Stat label="Live sessions" value={sessions.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="space-y-1.5 text-sm">
            <Row label="User id"><code className="text-xs text-zinc-400">{profile.id}</code></Row>
            <Row label="Registered"><When value={profile.createdAt} /></Row>
            <Row label="Last sign-in"><When value={profile.lastSignInAt} /></Row>
            <Row label="Age confirmed"><When value={profile.ageConfirmedAt} /></Row>
            {profile.excludedUntil && (
              <Row label="Self-excluded until"><When value={profile.excludedUntil} /></Row>
            )}
            {profile.suspendedAt && (
              <>
                <Row label="Suspended"><When value={profile.suspendedAt} /></Row>
                <Row label="Reason"><span className="text-zinc-300">{profile.suspendedReason}</span></Row>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Sign-in methods">
          {profile.identities.length ? (
            <ul className="space-y-2 text-sm">
              {profile.identities.map((i) => (
                <li key={`${i.provider}-${i.createdAt.toISOString()}`} className="flex flex-wrap gap-x-3">
                  <span className="text-zinc-200">{i.provider}</span>
                  <span className="text-zinc-500">{i.email}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    last seen <When value={i.lastSeenAt} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No linked provider. This account predates the move off Supabase and will link on
              their next Google sign-in.
            </p>
          )}
        </Panel>

        <Panel title="Devices with a live session">
          {sessions.length ? (
            <ul className="space-y-2 text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="truncate text-zinc-300">{s.userAgent ?? "unknown device"}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    since <When value={s.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No live sessions.</p>
          )}
          {/* No token, no hash. The dashboard answers who someone is, not how to become them. */}
        </Panel>

        <Panel title="Recent slips">
          {recentSlips.length ? (
            <ul className="space-y-2 text-sm">
              {recentSlips.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-zinc-300">{s.bookmaker.name}</span>
                  <span className="text-zinc-500">{s.kind.toLowerCase()}</span>
                  {s.bookingCode && <code className="text-xs text-[#CCFF2E]">{s.bookingCode}</code>}
                  <span className="ml-auto text-xs"><When value={s.createdAt} /></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No slips.</p>
          )}
        </Panel>
      </div>

      <Panel title={profile.suspendedAt ? "Reactivate" : "Suspend"}>
        {profile.suspendedAt ? (
          <form action={reactivate} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={profile.id} />
            <button className="rounded border border-[#CCFF2E]/40 bg-[#CCFF2E]/10 px-3 py-1.5 text-sm text-[#CCFF2E] hover:bg-[#CCFF2E]/20">
              Reactivate account
            </button>
            <span className="text-xs text-zinc-500">
              Their old sessions stay revoked; they will sign in again.
            </span>
          </form>
        ) : (
          <form action={suspend} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={profile.id} />
            <input
              name="reason"
              required
              placeholder="Reason (recorded in the audit trail)"
              className="w-full max-w-sm rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm placeholder:text-zinc-600 focus:border-red-400 focus:outline-none"
            />
            <button className="rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20">
              Suspend account
            </button>
            <span className="text-xs text-zinc-500">Signs them out of every device.</span>
          </form>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-40 shrink-0 text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
