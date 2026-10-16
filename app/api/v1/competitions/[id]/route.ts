import { z } from "zod";
import { ok, route } from "@/lib/api";
import { optionalAdult } from "@/lib/auth";
import { clientIpHash } from "@/lib/request";
import { meterPublicBrowse } from "@/lib/services/usage";
import { AppError } from "@/lib/errors";
import { getCompetitionPage } from "@/lib/services/directory";

export const GET = route<RouteContext<"/api/v1/competitions/[id]">>(async (req, { params }) => {
  const { user } = await optionalAdult(req.headers.get("authorization"));
  await meterPublicBrowse(user?.id, clientIpHash(req));
  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) throw new AppError("NOT_FOUND", "We couldn't find that competition.");
  return ok(await getCompetitionPage(user, id.data));
});
