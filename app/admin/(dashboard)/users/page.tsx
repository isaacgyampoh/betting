import Link from "next/link";
import { requireAdmin } from "@/lib/identity/admin";
import { listUsers } from "@/lib/services/admin";
import { Pager, Pill, When } from "../_components";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  // Parsed, not trusted. listUsers clamps the page size itself; this only has to not be NaN.
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const result = await listUsers({ search, page });

  return (
    <div className="space-y-4">
      <form className="flex gap-2" action="/admin/users">
        <input
          name="q"
          defaultValue={search ?? ""}
          placeholder="Email, name or exact user id"
          className="w-full max-w-sm rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm placeholder:text-zinc-600 focus:border-[#CCFF2E] focus:outline-none"
        />
        <button className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
          Search
        </button>
        {search && (
          <Link href="/admin/users" className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">
            Clear
          </Link>
        )}
      </form>

      <div className="text-xs text-zinc-500">
        {result.total} {result.total === 1 ? "account" : "accounts"}
        {search && " matching"}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium">Sign-in</th>
              <th className="px-4 py-2 font-medium">Registered</th>
              <th className="px-4 py-2 font-medium">Last seen</th>
              <th className="px-4 py-2 font-medium">Slips</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-800/70">
                <td className="px-4 py-2">
                  <Link href={`/admin/users/${u.id}`} className="text-zinc-200 hover:text-[#CCFF2E]">
                    {u.email ?? u.displayName ?? u.id.slice(0, 8)}
                  </Link>
                  {u.role === "ADMIN" && <span className="ml-2 text-xs text-[#CCFF2E]">admin</span>}
                </td>
                <td className="px-4 py-2 text-zinc-400">
                  {u.providers.length ? u.providers.join(", ") : <span className="text-zinc-600">none</span>}
                </td>
                <td className="px-4 py-2"><When value={u.createdAt} /></td>
                <td className="px-4 py-2"><When value={u.lastSignInAt} /></td>
                <td className="px-4 py-2 tabular-nums text-zinc-400">{u.slips}</td>
                <td className="px-4 py-2">
                  {u.suspended ? <Pill state="bad">suspended</Pill> : <Pill state="ok">active</Pill>}
                </td>
              </tr>
            ))}
            {!result.users.length && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Nothing matched.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={result.page} pages={result.pages} base={`/admin/users${search ? `?q=${encodeURIComponent(search)}` : ""}`} />
    </div>
  );
}
