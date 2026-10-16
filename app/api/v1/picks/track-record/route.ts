import { z } from "zod";
import { ok, route } from "@/lib/api";
import { getTrackRecord } from "@/lib/services/daily-picks";

export const dynamic = "force-dynamic";

// "30d" is a rolling window on the day each pick was published for. A lifetime figure built on a
// handful of picks describes a period nobody is betting in any more, in both directions.
const windowSchema = z.enum(["all", "30d"]).catch("all");

/** Public: the record must be checkable without an account. */
export const GET = route(async (req) =>
  ok(await getTrackRecord(60, windowSchema.parse(req.nextUrl.searchParams.get("window") ?? undefined))),
);
