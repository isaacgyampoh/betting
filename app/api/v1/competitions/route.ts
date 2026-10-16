import { z } from "zod";
import { ok, route } from "@/lib/api";
import { optionalAdult } from "@/lib/auth";
import { clientIpHash } from "@/lib/request";
import { meterPublicBrowse } from "@/lib/services/usage";
import { listCompetitions } from "@/lib/services/directory";

const querySchema = z.object({
  country: z.string().trim().max(60).optional(),
  search: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

export const GET = route(async (req) => {
  const { user } = await optionalAdult(req.headers.get("authorization"));
  await meterPublicBrowse(user?.id, clientIpHash(req));
  const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return ok(await listCompetitions(q));
});
