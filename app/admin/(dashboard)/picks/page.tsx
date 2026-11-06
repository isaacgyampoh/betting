import Link from "next/link";
import { requireAdmin } from "@/lib/identity/admin";
import { accraDate } from "@/lib/special-picks/fixture-date";
import { pipelineStatus, recentDays } from "@/lib/services/admin-picks";
import { Panel, Pill, Stat, When } from "../_components";

export const dynamic = "force-dynamic";

/**
 * The Slip Desk.
 *
 * The product is one slip a day, and until now nothing in the dashboard knew that. This page is
 * the day list and the state of the three jobs that produce it - deliberately in that order,
 * because the question "did today's slip go out, and is it sound" is asked far more often than
 * anything about users.
 */
export default async function PicksPage() {
  await requireAdmin();
  const now = new Date();
  const [jobs, days] = await Promise.all([pipelineStatus(now), recentDays(14, now)]);

  const today = days[0];
  const problems = days.reduce((n, d) => n + d.bad, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold">Slip desk</h1>
        <span className="text-sm text-zinc-500">{accraDate(now)} · Africa/Accra</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Today" value={today?.reference ?? "no slip"} hint={today?.legs ? `${today.legs} selections` : "nothing published"} />
        <Stat label="Combined" value={today?.combinedOdds ?? "—"} hint="target 2.00" />
        <Stat label="Needs attention" value={problems} hint="across the last 14 days" />
        <Stat label="Jobs healthy" value={`${jobs.filter((j) => j.state === "ok").length}/${jobs.length}`} />
      </div>

      <Panel title="Scheduled jobs, judged by what they leave behind">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-1 font-medium">Job</th>
              <th className="py-1 font-medium">Schedule</th>
              <th className="py-1 font-medium">Last effect</th>
              <th className="py-1 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.key} className="border-t border-zinc-800/70 align-top">
                <td className="py-2">
                  <div className="text-zinc-200">{j.label}</div>
                  <div className="text-xs text-zinc-600">{j.evidence}</div>
                </td>
                <td className="py-2"><code className="text-xs text-zinc-400">{j.schedule}</code></td>
                <td className="py-2"><When value={j.lastAt} /></td>
                <td className="py-2">
                  <Pill state={j.state}>{j.state === "ok" ? "running" : j.state === "warn" ? "quiet" : "never run"}</Pill>
                  <div className="mt-1 max-w-xs text-xs text-zinc-500">{j.note}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-500">
          There is no job-run log, so each row is inferred from the newest row that job writes. A job
          with nothing to do leaves no trace, which is why &ldquo;quiet&rdquo; is a question and not a verdict —
          but a job that has <em>never</em> written anything cannot hide here, and that is the failure this
          pipeline actually had.
        </p>
      </Panel>

      <Panel title="The last 14 days">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Reference</th>
              <th className="py-1 font-medium">Combined</th>
              <th className="py-1 font-medium">Legs</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">Findings</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-zinc-800/70">
                <td className="py-1.5">
                  <Link href={`/admin/picks/${d.date}`} className="tabular-nums text-[#CCFF2E] hover:underline">
                    {d.date}
                  </Link>
                </td>
                <td className="py-1.5 text-zinc-400">{d.reference ?? "—"}</td>
                <td className="py-1.5 tabular-nums text-zinc-300">{d.combinedOdds ?? "—"}</td>
                <td className="py-1.5 tabular-nums text-zinc-400">{d.legs || "—"}</td>
                <td className="py-1.5">
                  {d.status === "NONE" ? (
                    <span className="text-xs text-zinc-600">no slip</span>
                  ) : (
                    <Pill state={d.status === "WON" ? "ok" : d.status === "LOST" ? "bad" : "idle"}>
                      {d.status.toLowerCase()}
                    </Pill>
                  )}
                </td>
                <td className="py-1.5">
                  {d.bad > 0 && <Pill state="bad">{d.bad} serious</Pill>}
                  {d.bad > 0 && d.warn > 0 && " "}
                  {d.warn > 0 && <Pill state="warn">{d.warn} to check</Pill>}
                  {d.bad === 0 && d.warn === 0 && d.legs > 0 && <Pill state="ok">clean</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-500">
          A day with no slip is a normal outcome, not a gap: no qualifying selections means no slip, and
          the generator will never reach into another day to fill one.
        </p>
      </Panel>
    </div>
  );
}
