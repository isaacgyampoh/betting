import { z } from "zod";
import { ok, route } from "@/lib/api";
import { optionalAdult } from "@/lib/auth";
import { clientIpHash } from "@/lib/request";
import { meterPublicBrowse } from "@/lib/services/usage";
import { AppError } from "@/lib/errors";
import { getMatchDetail } from "@/lib/services/stats";

/**
 * Which panels to build, so a screen need not wait for the ones it is not showing.
 *
 * The match centre opens on Overview, which needs the teams, their form and the head-to-head.
 * The timeline, the statistics, the line-ups and the table sit behind tabs nobody has touched
 * yet - and waiting for all eight before drawing anything is what made opening a match feel
 * slow. Measured warm on the deployed Worker, with every one of those already cached and no
 * upstream call made at all, the full set still took about three and a half seconds of database
 * round trips. Omitted, this returns everything, so an older build is unaffected.
 */
const sectionsSchema = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.enum(["form", "h2h", "standings", "events", "statistics", "lineups"])).min(1))
  .optional()
  .catch(undefined);

export const GET = route<RouteContext<"/api/v1/matches/[id]">>(async (req, { params }) => {
  const { user } = await optionalAdult(req.headers.get("authorization"));
  await meterPublicBrowse(user?.id, clientIpHash(req));
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "We couldn't find that match.");
  const sections = sectionsSchema.parse(req.nextUrl.searchParams.get("sections") ?? undefined);
  return ok(
    await getMatchDetail(user, id.data, req.nextUrl.searchParams.get("date") ?? undefined, { sections }),
  );
});
