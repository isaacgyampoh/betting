import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthUser } from "@/lib/auth";
import { ANALYSIS_MODEL, costMicroUsd, supportsServerFallback, type TokenUsage } from "@/lib/ai/models";
import { anthropic } from "@/lib/ai/client";
import { compactMatchDetail } from "@/lib/ai/compact";
import { getMatchDetail } from "@/lib/services/stats";
import { getAiAllowance } from "@/lib/services/ai-quota";
import { logUsage } from "@/lib/services/usage";

const ANALYSIS_TTL_MS = 3 * 60 * 60_000;

const SYSTEM = `You are a football analyst for Ghanaian bettors. You receive match data as JSON: recent form, head-to-head, standings.
Write a concise analysis (max ~250 words) in plain English:
1. What the data shows about each team (form, goals, table position).
2. Which markets the numbers lean towards (1X2, double chance, over/under, BTTS), with the specific stats behind each lean.
3. The main risks and what the data can't tell you (injuries, line-ups, motivation are NOT in the data).
Rules: use only the numbers in the JSON; never invent stats, injuries or news. If "not_available_on_stats_plan" lists sections, say those numbers weren't available rather than guessing them. Do not state certainties or guarantees. No odds unless given.
End with: "Stats, not guarantees. Bet responsibly."`;

/**
 * Deep match analysis with the larger model. Results are cached per match for a few hours and
 * shared between users (same data in, same analysis out), so repeat requests cost nothing.
 */
export async function analyzeMatch(user: AuthUser, matchId: number): Promise<{ analysis: string; cached: boolean; source: string }> {
  const allowance = await getAiAllowance(user.id);
  if (!allowance.allowDeepAnalysis) {
    throw new AppError("PLAN_LIMIT_REACHED", "Deep match analysis is included in the Weekly and Monthly plans.");
  }

  const detail = await getMatchDetail(user, matchId);
  if (detail.unavailable.includes("form") && detail.h2h.length === 0) {
    throw new AppError("BAD_REQUEST", "There isn't enough data for a useful analysis of this match yet.");
  }
  const key = `analysis:${ANALYSIS_MODEL}:${matchId}`;
  const hit = await db.statsCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > new Date()) {
    return { analysis: (hit.payload as { text: string }).text, cached: true, source: detail.source };
  }

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await anthropic().beta.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(compactMatchDetail(detail)) }],
      ...(supportsServerFallback(ANALYSIS_MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (err) {
    logger.error("ai.analysis_failed", { matchId, err });
    await logUsage({ userId: user.id, kind: "AI_ANALYSIS", success: false, errorCode: "AI_UNAVAILABLE", model: ANALYSIS_MODEL, meta: { matchId } });
    throw new AppError("AI_UNAVAILABLE", "The analysis service is busy. Please try again in a minute.", { cause: err });
  }

  const usage: TokenUsage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  await logUsage({
    userId: user.id,
    kind: "AI_ANALYSIS",
    success: response.stop_reason !== "refusal",
    model: response.model,
    inputTokens: usage.input + usage.cacheWrite,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    costMicroUsd: costMicroUsd(response.model, usage),
    meta: { matchId, stopReason: response.stop_reason },
  });

  if (response.stop_reason === "refusal") {
    throw new AppError("BAD_REQUEST", "The analysis couldn't be produced for this match.");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  await db.statsCache.upsert({
    where: { key },
    create: { key, endpoint: "analysis", params: { matchId }, payload: { text }, expiresAt: new Date(Date.now() + ANALYSIS_TTL_MS) },
    update: { payload: { text }, expiresAt: new Date(Date.now() + ANALYSIS_TTL_MS), fetchedAt: new Date() },
  });
  return { analysis: text, cached: false, source: detail.source };
}
