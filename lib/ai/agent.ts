import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AuthUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { SlipView } from "@/lib/slips/view";
import { anthropic } from "@/lib/ai/client";
import { addUsage, CHAT_MODEL, costMicroUsd, ZERO_USAGE, type TokenUsage } from "@/lib/ai/models";
import { runTool, TOOLS, type ToolContext } from "@/lib/ai/tools";
import { consumeTrialCredit, getAiAllowance, requireAiAllowance, type AiAllowance } from "@/lib/services/ai-quota";
import { logUsage } from "@/lib/services/usage";

const MAX_ITERATIONS = 6;
const MAX_HISTORY = 12;

// Stable system prompt (cached with the tools). Anything that changes per request goes after it.
const SYSTEM_PROMPT = `You are gameclaw, a betting slip assistant for Ghanaian bettors (18+). You help load, convert and edit booking codes, and look up match stats.

Supported bookmakers: sportybet (SportyBet), betway (Betway). Money is in GHS. Times are GMT (Ghana).

Rules:
- Every odd, score, stat and booking code must come from a tool result in this conversation. Never invent or estimate them. If a tool fails, say what went wrong plainly.
- Chain tools to finish the job, e.g. load_slip → convert_slip → edit_slip. Reuse slip_ids from earlier tool results.
- After converting, always list games that couldn't be carried over and why.
- Show new booking codes prominently. Keep answers short and scannable (short lines, simple bullets).
- For "who will win"/tips: share what the stats show (get_match_stats or analyze_match), never certainties. Add "Stats, not guarantees."
- If data_source says SAMPLE DATA, tell the user the stats are sample data, not real results.
- Don't help anyone who says they are under 18. If the user seems to be chasing losses or in distress, gently point them to /responsible-gambling.
- Stay on topic: slips, bookmakers, matches, stats, and using gameclaw.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  reply: string;
  slips: SlipView[];
  allowance: AiAllowance;
};

function contextNote(matchId?: number) {
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Current time: ${now} GMT.${matchId ? ` The user opened this chat from match_id ${matchId}.` : ""}`;
}

function usageOf(u: Anthropic.Usage): TokenUsage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

// Plan token limits count uncached input + cache writes + output; cache reads are tracked separately.
function usageColumns(u: TokenUsage) {
  return {
    inputTokens: u.input + u.cacheWrite,
    outputTokens: u.output,
    cacheReadTokens: u.cacheRead,
    costMicroUsd: costMicroUsd(CHAT_MODEL, u),
  };
}

/**
 * One chat request: a manual tool loop on the fast model, metered per iteration and
 * billed as one AI request. Deep analysis is a tool that calls the larger model.
 */
export async function runChat(opts: { user: AuthUser; history: ChatTurn[]; ipHash: string | null; matchId?: number }): Promise<ChatResult> {
  const { user, ipHash } = opts;
  const allowance = await requireAiAllowance(user.id);

  const history = opts.history.slice(-MAX_HISTORY);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") {
    throw new AppError("BAD_REQUEST", "The last message must be from the user.");
  }

  const messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
  const ctx: ToolContext = { user, ipHash, slips: new Map() };
  let usage = ZERO_USAGE;
  let reply = "";
  let toolCalls = 0;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic().messages.create({
        model: CHAT_MODEL,
        max_tokens: 2048,
        // Caches tools + system + conversation so tool-loop iterations reuse the prefix.
        cache_control: { type: "ephemeral" },
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: contextNote(opts.matchId) },
        ],
        tools: TOOLS,
        messages,
      });
      usage = addUsage(usage, usageOf(response.usage));

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (response.stop_reason === "refusal") {
        reply = "Sorry, I can't help with that.";
        break;
      }
      if (response.stop_reason !== "tool_use") {
        reply = text || (response.stop_reason === "max_tokens" ? "That answer got too long. Please ask a narrower question." : "");
        break;
      }

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      toolCalls += toolUses.length;
      messages.push({ role: "assistant", content: response.content });
      // Parallel tool calls: run concurrently, return all results in one user message.
      const results = await Promise.all(
        toolUses.map(async (t): Promise<Anthropic.ToolResultBlockParam> => {
          const r = await runTool(t.name, t.input, ctx);
          logger.info("ai.tool", { userId: user.id, tool: t.name, isError: r.isError });
          return { type: "tool_result", tool_use_id: t.id, content: r.content, is_error: r.isError };
        }),
      );
      messages.push({ role: "user", content: results });
      if (i === MAX_ITERATIONS - 1) reply = text || "I ran out of steps for this request. Try splitting it into smaller asks.";
    }
  } catch (err) {
    await logUsage({
      userId: user.id,
      ipHash,
      kind: "AI_CHAT",
      success: false,
      errorCode: err instanceof AppError ? err.code : "AI_UNAVAILABLE",
      model: CHAT_MODEL,
      ...usageColumns(usage),
      meta: { toolCalls },
    });
    if (err instanceof AppError) throw err;
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      logger.warn("ai.provider_unavailable", { err });
      throw new AppError("AI_UNAVAILABLE", "The assistant is busy right now. Please try again in a minute.", { cause: err });
    }
    logger.error("ai.chat_failed", { err });
    throw new AppError("AI_UNAVAILABLE", "The assistant hit a problem. Please try again.", { cause: err });
  }

  await logUsage({
    userId: user.id,
    ipHash,
    kind: "AI_CHAT",
    success: true,
    model: CHAT_MODEL,
    ...usageColumns(usage),
    meta: { toolCalls },
  });
  await consumeTrialCredit(user.id, allowance);

  return { reply, slips: [...ctx.slips.values()], allowance: await getAiAllowance(user.id) };
}
