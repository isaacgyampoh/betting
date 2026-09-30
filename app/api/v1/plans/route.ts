import { ok, route } from "@/lib/api";
import { listActivePlans } from "@/lib/services/plans";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await listActivePlans()));
