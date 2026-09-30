import { z } from "zod";
import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { listMatches } from "@/lib/services/stats";

const dateSchema = z.iso.date().catch(() => new Date().toISOString().slice(0, 10));

export const GET = route(async (req) => {
  await requireAdult(req.headers.get("authorization"));
  const date = dateSchema.parse(req.nextUrl.searchParams.get("date") ?? undefined);
  return ok({ date, ...(await listMatches(date)) });
});
