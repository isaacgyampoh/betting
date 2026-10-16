import { z } from "zod";
import { ok, route } from "@/lib/api";
import { optionalAdult } from "@/lib/auth";
import { clientIpHash } from "@/lib/request";
import { meterPublicBrowse } from "@/lib/services/usage";
import { AppError } from "@/lib/errors";
import { lookupMatch } from "@/lib/services/stats";

const querySchema = z.object({ home: z.string().min(1).max(80), away: z.string().min(1).max(80), kickoff: z.iso.datetime() });

export const GET = route(async (req) => {
  const { user } = await optionalAdult(req.headers.get("authorization"));
  await meterPublicBrowse(user?.id, clientIpHash(req));
  const q = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) throw new AppError("BAD_REQUEST", "Provide home, away and kickoff (ISO time).");
  const match = await lookupMatch(q.data.home, q.data.away, new Date(q.data.kickoff));
  if (!match) throw new AppError("NOT_FOUND", "We couldn't find stats for that game.");
  return ok(match);
});
