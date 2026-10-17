import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/identity/admin";
import { setSetting, settings } from "@/lib/services/admin";
import { Panel, When } from "../_components";

export const dynamic = "force-dynamic";

/**
 * Settings an administrator may change without a deploy.
 *
 * What is NOT here: anything secret. No API key, no signing secret, no database URL, not even
 * masked. The dashboard shows these values in full by design, so a secret that reached this
 * table would be on screen - and the table is also readable by anything with database access.
 * Secrets belong in the service's environment, where they are write-only from outside.
 */
async function save(formData: FormData) {
  "use server";
  // Its own check: a server action is a POST endpoint that can be called without rendering the
  // page the button lives on.
  const admin = await requireAdmin();
  const key = String(formData.get("key") ?? "").trim();
  const raw = String(formData.get("value") ?? "").trim();
  if (!key) return;

  // Stored as JSON so a flag can be a boolean, a number or a small object. Plain text that is
  // not valid JSON is stored as a JSON string rather than rejected, because "maintenance" is a
  // reasonable thing to type and failing on it would be pedantry.
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  await setSetting(admin.id, key, value, String(formData.get("description") ?? "") || undefined);
  revalidatePath("/admin/settings");
}

export default async function SettingsPage() {
  await requireAdmin();
  const rows = await settings();

  return (
    <div className="space-y-4">
      <Panel title="Application settings">
        {rows.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Key</th>
                <th className="py-1 font-medium">Value</th>
                <th className="py-1 font-medium">Description</th>
                <th className="py-1 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} className="border-t border-zinc-800/70 align-top">
                  <td className="py-1.5"><code className="text-xs text-[#CCFF2E]">{s.key}</code></td>
                  <td className="py-1.5 text-zinc-300">{JSON.stringify(s.value)}</td>
                  <td className="py-1.5 text-zinc-500">{s.description ?? "—"}</td>
                  <td className="py-1.5"><When value={s.updatedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-zinc-500">
            No settings yet. Anything added here is readable by every administrator and stored in
            plain text, so it must never hold a credential.
          </p>
        )}
      </Panel>

      <Panel title="Add or change a setting">
        <form action={save} className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-zinc-500">
            Key
            <input
              name="key"
              required
              placeholder="picks.enabled"
              className="mt-1 block w-48 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-[#CCFF2E] focus:outline-none"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Value (JSON)
            <input
              name="value"
              required
              placeholder="true"
              className="mt-1 block w-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-[#CCFF2E] focus:outline-none"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Description
            <input
              name="description"
              placeholder="What this controls"
              className="mt-1 block w-64 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-[#CCFF2E] focus:outline-none"
            />
          </label>
          <button className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
            Save
          </button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          Changes are recorded in the audit trail with the previous value.
        </p>
      </Panel>
    </div>
  );
}
