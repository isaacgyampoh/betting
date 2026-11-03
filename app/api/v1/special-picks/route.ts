import { ok, route } from "@/lib/api";
import { listSpecialHistory, listSpecialPicks, specialPerformance } from "@/lib/services/special-picks";

export const dynamic = "force-dynamic";

/**
 * Today's Daily Special Picks, with the published record alongside them.
 *
 * Public, like the accumulator picks: the selections are a published claim and the record is the
 * evidence for it, so neither is hidden behind a session. There is no personalisation here, which
 * is also why nothing is metered.
 *
 * An empty `picks` array is a normal answer, not an error. The research threshold is set expecting
 * days where nothing qualifies, and the interface says so rather than showing a blank panel.
 *
 * `?history=1` adds every published day. It is opt-in because the phone only wants today and the
 * history is two orders of magnitude larger; the website's record page is the one caller that
 * needs it. Both shapes are served from here rather than from a second route, so the Worker's
 * forward allowlist stays one entry and the two can never disagree about a selection.
 */
export const GET = route(async (req: Request) => {
  const wantsHistory = new URL(req.url).searchParams.get("history") === "1";

  const [picks, performance, history] = await Promise.all([
    listSpecialPicks(),
    specialPerformance(),
    wantsHistory ? listSpecialHistory() : Promise.resolve(undefined),
  ]);

  return ok({ picks, performance, ...(history ? { history } : {}) });
});
