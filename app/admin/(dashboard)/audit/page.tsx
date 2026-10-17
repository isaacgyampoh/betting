import { requireAdmin } from "@/lib/identity/admin";
import { auditTrail } from "@/lib/services/admin";
import { Pager, When } from "../_components";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await auditTrail({ page: Number.parseInt(sp.page ?? "1", 10) || 1 });

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Every administrative change, newest first. Nothing in the application updates or deletes
        these rows — an audit trail that can be edited from the dashboard it audits is not one.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Target</th>
              <th className="px-4 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {result.entries.map((e) => (
              <tr key={e.id} className="border-t border-zinc-800/70 align-top">
                <td className="px-4 py-2 whitespace-nowrap"><When value={e.createdAt} /></td>
                <td className="px-4 py-2 text-zinc-300">{e.actor.email ?? e.actor.id.slice(0, 8)}</td>
                <td className="px-4 py-2"><code className="text-xs text-[#CCFF2E]">{e.action}</code></td>
                <td className="px-4 py-2"><code className="text-xs text-zinc-500">{e.target?.slice(0, 8) ?? "—"}</code></td>
                <td className="px-4 py-2 text-xs text-zinc-400">
                  {e.detail ? JSON.stringify(e.detail) : "—"}
                </td>
              </tr>
            ))}
            {!result.entries.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">Nothing recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={result.page} pages={result.pages} base="/admin/audit" />
    </div>
  );
}
