import { requireAdmin } from "@/lib/identity/admin";
import { connectedBookmakers } from "@/lib/bookmakers/registry";
import { readiness } from "@/lib/readiness";
import { canSendPush } from "@/lib/services/fcm";
import { serviceHealth } from "@/lib/services/admin";
import { Panel, Pill, When } from "../_components";

export const dynamic = "force-dynamic";

/**
 * Whether each moving part is actually working.
 *
 * Every row is a fact read at request time, not a status somebody typed. The point of a health
 * page is to be believed, and a hard-coded "operational" is worse than no page at all.
 */
export default async function HealthPage() {
  await requireAdmin();
  const r = readiness();
  const h = await serviceHealth();
  const bookmakers = connectedBookmakers();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Database">
        <dl className="space-y-1.5 text-sm">
          <Row label="Reachable">
            {h.database.up ? <Pill state="ok">yes, {h.database.ms}ms</Pill> : <Pill state="bad">no</Pill>}
          </Row>
          <Row label="Cached provider rows">
            <span className="text-zinc-300">{h.cache.fresh} fresh of {h.cache.total}</span>
          </Row>
        </dl>
      </Panel>

      <Panel title="Football data">
        <dl className="space-y-1.5 text-sm">
          <Row label="Live statistics">
            {r.features.liveStats ? <Pill state="ok">configured</Pill> : <Pill state="bad">no provider key</Pill>}
          </Row>
          <Row label="Requests in the last hour">
            <span className="tabular-nums text-zinc-300">{h.usage.lastHour}</span>
          </Row>
          <Row label="Failed in the last 24h">
            {h.usage.failedDay === 0 ? (
              <Pill state="ok">none</Pill>
            ) : (
              <Pill state="warn">{h.usage.failedDay}</Pill>
            )}
          </Row>
        </dl>
      </Panel>

      <Panel title="Bookmakers">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-1 font-medium">Bookmaker</th>
              <th className="py-1 font-medium">Reads</th>
              <th className="py-1 font-medium">Books</th>
              <th className="py-1 font-medium">Prices</th>
            </tr>
          </thead>
          <tbody>
            {bookmakers.map((b) => (
              <tr key={b.slug} className="border-t border-zinc-800/70">
                <td className="py-1.5 text-zinc-300">{b.name}</td>
                <td className="py-1.5">{b.capabilities.loadCode ? <Pill state="ok">yes</Pill> : <Pill state="idle">no</Pill>}</td>
                <td className="py-1.5">{b.capabilities.createCode ? <Pill state="ok">yes</Pill> : <Pill state="idle">no</Pill>}</td>
                <td className="py-1.5">{b.capabilities.events ? <Pill state="ok">yes</Pill> : <Pill state="idle">no</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-500">
          Only bookmakers that have been proven end to end appear here. The rest are in the
          directory as setup or unsupported.
        </p>
      </Panel>

      <Panel title="Notifications and other services">
        <dl className="space-y-1.5 text-sm">
          <Row label="Push sending">
            {canSendPush() ? (
              <Pill state="ok">configured</Pill>
            ) : (
              <Pill state="bad">FCM_SERVICE_ACCOUNT not set</Pill>
            )}
          </Row>
          <Row label="Registered devices">
            <span className="tabular-nums text-zinc-300">{h.devices}</span>
          </Row>
          <Row label="AI">{r.features.ai ? <Pill state="ok">configured</Pill> : <Pill state="idle">off</Pill>}</Row>
          <Row label="Payments">
            {r.features.payments ? <Pill state="ok">configured</Pill> : <Pill state="idle">off</Pill>}
          </Row>
          <Row label="Checked"><When value={h.checkedAt} /></Row>
        </dl>
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-48 shrink-0 text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
