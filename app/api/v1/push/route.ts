import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { removePushSubscription, savePushSubscription } from "@/lib/services/push";

const subscribeSchema = z.object({
  endpoint: z.url().max(600),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
});

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const sub = await parseBody(req, subscribeSchema);
  await savePushSubscription(user.id, sub);
  return ok({ subscribed: true });
});

export const DELETE = route(async (req) => {
  await requireAdult(req.headers.get("authorization"));
  const { endpoint } = await parseBody(req, z.object({ endpoint: z.url().max(600) }));
  await removePushSubscription(endpoint);
  return ok({ subscribed: false });
});
