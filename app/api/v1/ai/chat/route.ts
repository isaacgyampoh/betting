import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { runChat } from "@/lib/ai/agent";
import { clientIpHash } from "@/lib/request";

export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(40),
  matchId: z.number().int().positive().optional(),
  seenSlipIds: z.array(z.uuid()).max(50).optional(),
});

export const POST = route(async (req) => {
  const { user } = await requireAdult(req.headers.get("authorization"));
  const body = await parseBody(req, bodySchema);
  return ok(await runChat({ user, history: body.messages, matchId: body.matchId, seenSlipIds: body.seenSlipIds, ipHash: clientIpHash(req) }));
});
