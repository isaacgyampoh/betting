import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { startCheckout } from "@/lib/services/billing";

const bodySchema = z.object({ plan: z.string().min(1).max(40) });

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const { plan } = await parseBody(req, bodySchema);
  return ok(await startCheckout(user, plan));
});
