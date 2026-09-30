import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AuthUser } from "@/lib/auth";
import { anthropic } from "@/lib/ai/client";
import { addUsage, CHAT_MODEL, costMicroUsd, ZERO_USAGE, type TokenUsage } from "@/lib/ai/models";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logUsage } from "@/lib/services/usage";

// Reads a screenshot or PDF of a betting slip: teams, market and price per row. The model only
// transcribes what it can see — matching rows to real fixtures happens afterwards, and anything
// unclear is shown back to the user to confirm.

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const SYSTEM = `You transcribe betting slips from images and PDFs. Return only what is legible.
Rules:
- Copy team names, market and price exactly as printed. Never correct, complete or invent them.
- If a field is unreadable, use null. Do not guess.
- "confidence" is your certainty that the whole row was read correctly.
- Prices are decimal odds (e.g. 1.85). If the slip shows fractional or American odds, convert and set "converted": true.
- Ignore stake, potential winnings, adverts and usernames.`;

const rowSchema = z.object({
  home: z.string().nullable(),
  away: z.string().nullable(),
  market: z.string().nullable(),
  pick: z.string().nullable(),
  odds: z.number().positive().nullable(),
  kickoff_text: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});

const extractionSchema = z.object({
  is_betting_slip: z.boolean(),
  bookmaker: z.string().nullable(),
  booking_code: z.string().nullable(),
  total_odds: z.number().positive().nullable(),
  rows: z.array(rowSchema).max(40),
  notes: z.string().nullable(),
});

export type ExtractedSlip = z.infer<typeof extractionSchema>;

const TOOL: Anthropic.Tool = {
  name: "record_slip",
  description: "Record what is legible on the betting slip.",
  input_schema: {
    type: "object",
    properties: {
      is_betting_slip: { type: "boolean", description: "False if the image is not a betting slip." },
      bookmaker: { type: "string", description: "Bookmaker name if shown, else null." },
      booking_code: { type: "string", description: "Booking/share code if shown, else null." },
      total_odds: { type: "number", description: "Total odds if shown, else null." },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            home: { type: "string" },
            away: { type: "string" },
            market: { type: "string", description: "As printed, e.g. '1X2', 'Over/Under 2.5'." },
            pick: { type: "string", description: "The selection, e.g. 'Arsenal', 'Over 2.5'." },
            odds: { type: "number" },
            kickoff_text: { type: "string", description: "Date/time as printed, if any." },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["home", "away", "market", "pick", "odds", "confidence"],
        },
      },
      notes: { type: "string", description: "Anything the user should know, e.g. part of the slip is cut off." },
    },
    required: ["is_betting_slip", "bookmaker", "booking_code", "total_odds", "rows", "notes"],
  },
};

export type UploadedFile = { data: string; mediaType: string };

/** Reads a slip image or PDF. Throws AppError for anything the user can act on. */
export async function extractSlipFromFile(user: AuthUser, file: UploadedFile, ipHash: string | null): Promise<ExtractedSlip> {
  const isPdf = file.mediaType === "application/pdf";
  if (!isPdf && !(IMAGE_TYPES as readonly string[]).includes(file.mediaType)) {
    throw new AppError("BAD_REQUEST", "Upload a photo (JPEG, PNG, GIF or WebP) or a PDF.");
  }
  if (Buffer.byteLength(file.data, "base64") > MAX_UPLOAD_BYTES) {
    throw new AppError("BAD_REQUEST", "That file is too big. Please upload something under 4 MB.");
  }

  const content: Anthropic.ContentBlockParam[] = [
    isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } }
      : { type: "image", source: { type: "base64", media_type: file.mediaType as (typeof IMAGE_TYPES)[number], data: file.data } },
    { type: "text", text: "Transcribe this betting slip with the record_slip tool." },
  ];

  let response: Anthropic.Message;
  let usage: TokenUsage = ZERO_USAGE;
  try {
    response = await anthropic().messages.create({
      model: CHAT_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [TOOL],
      messages: [{ role: "user", content }],
    });
    usage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    };
  } catch (err) {
    logger.error("ai.extract_failed", { err });
    await logUsage({ userId: user.id, ipHash, kind: "AI_CHAT", success: false, errorCode: "AI_UNAVAILABLE", model: CHAT_MODEL, meta: { op: "extract" } });
    throw new AppError("AI_UNAVAILABLE", "We couldn't read that file right now. Please try again in a minute.", { cause: err });
  }

  await logUsage({
    userId: user.id,
    ipHash,
    kind: "AI_CHAT",
    success: true,
    model: response.model,
    inputTokens: usage.input + usage.cacheWrite,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    costMicroUsd: costMicroUsd(response.model, usage),
    meta: { op: "extract" },
  });

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "record_slip");
  if (!call) throw new AppError("BAD_REQUEST", "We couldn't find a betting slip in that file. Try a clearer screenshot.");

  const parsed = extractionSchema.safeParse(call.input);
  if (!parsed.success) {
    logger.warn("ai.extract_invalid", { issues: parsed.error.issues.slice(0, 3) });
    throw new AppError("BAD_REQUEST", "We couldn't read that slip clearly. Try a sharper screenshot, or type the games out.");
  }
  if (!parsed.data.is_betting_slip || parsed.data.rows.length === 0) {
    throw new AppError("BAD_REQUEST", "That doesn't look like a betting slip. Upload a screenshot of the slip itself.");
  }
  return parsed.data;
}

export { addUsage };
