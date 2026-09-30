import { ok, route } from "@/lib/api";
import { listEnabledBookmakers } from "@/lib/services/bookmakers";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await listEnabledBookmakers()));
