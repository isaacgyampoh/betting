import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/identity/admin";
import { dryRunDate, slipDesk, voidSpecialPick, voidSpecialSlip } from "@/lib/services/admin-picks";
import { Ev, FindingList, Panel, Pill, SeverityPill, When } from "../../_components";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Voiding, as server actions.
 *
 * Each re-checks the administrator for itself. A server action is a POST endpoint with its own
 * URL and can be invoked without ever rendering the page the button sits on, so guarding the
 * render is not guarding the action.
 *
 * Neither action can edit anything. There is no form here that changes a price, a probability, a
 * reason or a result, and that is the design rather than an omission: the public record is only
 * worth reading if yesterday's slip still says today what it said when it went out.
 */
async function voidLeg(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "");
  await voidSpecialPick(admin.id, id, String(formData.get("reason") ?? ""));
  revalidatePath(`/admin/picks/${date}`);
}

async function voidWholeSlip(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "");
  await voidSpecialSlip(admin.id, id, String(formData.get("reason") ?? ""));
  revalidatePath(`/admin/picks/${date}`);
}

export default async function PicksDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ dryrun?: string }>;
}) {
  await requireAdmin();
  const { date } = await params;
  if (!DATE.test(date)) notFound();
  const { dryrun } = await searchParams;

  const desk = await slipDesk(date);
  // Only on request. It calls the bookmaker, and a page that does that on every render turns a
  // refresh into traffic somebody else is paying for.
  const dry = dryrun ? await dryRunDate(date) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/picks" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Slip desk
        </Link>
        <h1 className="text-lg font-semibold tabular-nums">{date}</h1>
        {desk.slip && <span className="text-sm text-zinc-500">{desk.slip.reference}</span>}
        <SeverityPill severity={desk.severity} />
        <Link
          href={`/admin/picks/${date}?dryrun=1`}
          className="ml-auto rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Dry-run this date
        </Link>
      </div>

      {!desk.slip && !desk.legs.length && (
        <Panel title="No slip for this date">
          <p className="text-sm text-zinc-400">
            Nothing was published. That is a legitimate outcome — no qualifying selections means no slip —
            and the dry run will show what a run today would have had to work with.
          </p>
        </Panel>
      )}

      {desk.slip && (
        <Panel title="The slip as published">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <p className="text-sm text-zinc-300">{desk.slip.summary}</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <Field label="Combined">
                  <span className="tabular-nums text-zinc-200">{desk.slip.combinedOdds}</span>
                  <span className="ml-1 text-xs text-zinc-500">target {desk.slip.target}</span>
                </Field>
                <Field label="Status">
                  <Pill state={desk.slip.status === "WON" ? "ok" : desk.slip.status === "LOST" ? "bad" : "idle"}>
                    {desk.slip.status.toLowerCase()}
                  </Pill>
                </Field>
                <Field label="Published"><When value={desk.slip.publishedAt} /></Field>
                <Field label="Last verified"><When value={desk.slip.lastVerifiedAt} /></Field>
              </dl>
            </div>
          </div>
          {desk.slipFindings.length > 0 && (
            <div className="mt-4">
              <FindingList findings={desk.slipFindings} />
            </div>
          )}
        </Panel>
      )}

      {desk.legs.map((leg) => (
        <Panel key={leg.id} title={`${leg.position}. ${leg.home} v ${leg.away}`}>
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                <Field label="Kick-off">
                  <When value={leg.kickoffAt} />
                  {leg.kickoffDay !== date ? (
                    <Pill state="bad">{leg.kickoffDay}</Pill>
                  ) : (
                    <span className="ml-1 text-xs text-zinc-600">same day</span>
                  )}
                </Field>
                <Field label="Competition">
                  <span className="text-zinc-400">{leg.competition ?? "—"}</span>
                </Field>
                <Field label="Selection">
                  <span className="text-zinc-200">
                    {leg.market} {leg.outcome.toLowerCase()} {leg.line}
                  </span>
                </Field>
                <Field label="Price">
                  <span className="tabular-nums text-zinc-200">{leg.odds ?? "—"}</span>
                  {leg.bookmaker && <span className="ml-1 text-xs text-zinc-500">{leg.bookmaker}</span>}
                </Field>
                <Field label="Our estimate">
                  <span className="tabular-nums text-zinc-300">{leg.probability.toFixed(2)}</span>
                  <span className="ml-1 text-xs text-zinc-500">{leg.sample} matches</span>
                </Field>
                <Field label="Expected value">
                  <Ev value={leg.ev} />
                </Field>
                <Field label="Rating">
                  <span className="tabular-nums text-zinc-400">{leg.rating}</span>
                  <span className="ml-1 text-xs text-zinc-500">{leg.confidence}</span>
                </Field>
                <Field label="Current price">
                  <span className="tabular-nums text-zinc-400">{leg.latestOdds ?? "not re-read"}</span>
                </Field>
                <Field label="Result">
                  <Pill state={leg.status === "WON" ? "ok" : leg.status === "LOST" ? "bad" : "idle"}>
                    {leg.status.toLowerCase()}
                  </Pill>
                  {leg.actual !== null && <span className="ml-1 text-xs text-zinc-500">actual {leg.actual}</span>}
                </Field>
              </dl>
              <p className="text-sm text-zinc-400">{leg.reason}</p>
              <FindingList findings={leg.findings} />
            </div>

            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
              {leg.status === "PENDING" ? (
                <form action={voidLeg} className="space-y-2">
                  <input type="hidden" name="id" value={leg.id} />
                  <input type="hidden" name="date" value={date} />
                  <label className="block text-xs text-zinc-500">
                    Reason, kept with the record
                    <textarea
                      name="reason"
                      required
                      minLength={4}
                      rows={3}
                      placeholder="Why this selection should not stand"
                      className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-[#CCFF2E] focus:outline-none"
                    />
                  </label>
                  <button className="w-full rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/10">
                    Void this selection
                  </button>
                  <p className="text-xs text-zinc-600">
                    Voiding removes it from the win rate without pretending it was never published. The
                    price, the evidence and the reason stay exactly as they were.
                  </p>
                </form>
              ) : (
                <p className="text-xs text-zinc-500">
                  Graded {leg.status.toLowerCase()}. A settled result cannot be changed here — the record
                  has to include the losses to be worth anything.
                </p>
              )}
            </div>
          </div>
        </Panel>
      ))}

      {desk.slip && desk.slip.status === "PENDING" && (
        <Panel title="Void the whole slip">
          <form action={voidWholeSlip} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={desk.slip.id} />
            <input type="hidden" name="date" value={date} />
            <label className="grow text-xs text-zinc-500">
              Reason
              <input
                name="reason"
                required
                minLength={4}
                placeholder="Why this slip should not stand"
                className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-[#CCFF2E] focus:outline-none"
              />
            </label>
            <button className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/10">
              Void slip and every open leg
            </button>
          </form>
          <p className="mt-3 text-xs text-zinc-500">
            Legs already graded keep their results. Recorded in the audit trail with your account and the
            reason.
          </p>
        </Panel>
      )}

      {dry && (
        <Panel title={`Dry run for ${dry.date}`}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
            <Field label="Source"><span className="text-zinc-300">{dry.bookmaker ?? "none"}</span></Field>
            <Field label="Feed returned"><span className="tabular-nums text-zinc-300">{dry.returned}</span></Field>
            <Field label="On this date"><span className="tabular-nums text-zinc-300">{dry.onDate}</span></Field>
            <Field label="Priced markets"><span className="tabular-nums text-zinc-300">{dry.candidates}</span></Field>
          </dl>

          {dry.rejected.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-xs uppercase tracking-wider text-zinc-500">Rejected, and why</h3>
              <ul className="space-y-1 text-xs">
                {dry.rejected.map((r) => (
                  <li key={r.reason} className="flex gap-3 text-zinc-400">
                    <span className="w-10 shrink-0 text-right tabular-nums text-zinc-300">{r.count}</span>
                    <span>{r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dry.fixtures.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-xs uppercase tracking-wider text-zinc-500">Would be considered</h3>
              <ul className="space-y-1 text-xs">
                {dry.fixtures.map((f) => (
                  <li key={`${f.home}-${f.away}`} className="flex flex-wrap gap-3 text-zinc-400">
                    <When value={f.kickoffAt} />
                    <span className="text-zinc-300">{f.home} v {f.away}</span>
                    <span className="text-zinc-600">{f.markets} priced markets</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-zinc-500">{dry.note}</p>
        </Panel>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">{children}</dd>
    </div>
  );
}
