import { ok, route } from "@/lib/api";
import { listSpecialPicks, specialPerformance } from "@/lib/services/special-picks";

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
 */
export const GET = route(async () => {
  const [picks, performance] = await Promise.all([listSpecialPicks(), specialPerformance()]);
  return ok({ picks, performance });
});
