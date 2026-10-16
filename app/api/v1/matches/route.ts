import { z } from "zod";
import { ok, route } from "@/lib/api";
import { optionalAdult } from "@/lib/auth";
import { clientIpHash } from "@/lib/request";
import { meterPublicBrowse } from "@/lib/services/usage";
import { listMatches } from "@/lib/services/stats";

const dateSchema = z.iso.date().catch(() => new Date().toISOString().slice(0, 10));

export const GET = route(async (req) => {
  const { user } = await optionalAdult(req.headers.get("authorization"));
  await meterPublicBrowse(user?.id, clientIpHash(req));
  const date = dateSchema.parse(req.nextUrl.searchParams.get("date") ?? undefined);
  return ok({ date, ...(await listMatches(date)) });
});
