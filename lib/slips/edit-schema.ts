import { z } from "zod";

// Shared by the REST API and the AI assistant's tools.
export const editOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("remove"), positions: z.array(z.number().int().min(1)).min(1).max(50) }),
  z.object({ type: z.literal("safest"), count: z.number().int().min(1).max(50) }),
  z.object({ type: z.literal("trim"), targetOdds: z.number().min(1.01).max(1_000_000) }),
  z.object({ type: z.literal("split"), parts: z.number().int().min(2).max(10) }),
]);
