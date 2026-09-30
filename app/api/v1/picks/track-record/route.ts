import { ok, route } from "@/lib/api";
import { getTrackRecord } from "@/lib/services/daily-picks";

export const dynamic = "force-dynamic";

/** Public: the record must be checkable without an account. */
export const GET = route(async () => ok(await getTrackRecord()));
