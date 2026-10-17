import Link from "next/link";
import { requireAdmin } from "@/lib/identity/admin";
import { ACTIVE_WINDOW_DAYS, overview } from "@/lib/services/admin";
import { Pill, Stat, When } from "./_components";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  // Checked again here, not only in the layout: a layout guards rendering, and relying on it
  // alone means a future page that forgets the call is silently public.
  await requireAdmin();
  const s = await overview();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Users" value={s.users.total} />
        <Stat label="New today" value={s.users.today} />
        <Stat label="This week" value={s.users.week} />
        <Stat label="This month" value={s.users.month} />
        <Stat label="Active" value={s.users.active} hint={`signed in within ${ACTIVE_WINDOW_DAYS} days`} />
        <Stat label="Suspended" value={s.users.suspended} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Slips" value={s.slips.total} />
        <Stat label="Slips this week" value={s.slips.week} />
        <Stat label="Live sessions" value={s.sessions.live} hint="unexpired refresh tokens" />
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50">
        <h2 className="border-b border-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300">
          Newest accounts
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium">Registered</th>
              <th className="px-4 py-2 font-medium">Last sign-in</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {s.recent.map((u) => (
              <tr key={u.id} className="border-t border-zinc-800/70">
                <td className="px-4 py-2">
                  <Link href={`/admin/users/${u.id}`} className="text-zinc-200 hover:text-[#CCFF2E]">
                    {u.email ?? u.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-2"><When value={u.createdAt} /></td>
                <td className="px-4 py-2"><When value={u.lastSignInAt} /></td>
                <td className="px-4 py-2">
                  {u.suspended ? <Pill state="bad">suspended</Pill> : <Pill state="ok">active</Pill>}
                </td>
              </tr>
            ))}
            {!s.recent.length && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">No accounts yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
