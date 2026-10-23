import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AuthUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { SlipView } from "@/lib/slips/view";
import { anthropic } from "@/lib/ai/client";
import { addUsage, CHAT_MODEL, costMicroUsd, ZERO_USAGE, type TokenUsage } from "@/lib/ai/models";
import { runTool, TOOLS, type ToolContext } from "@/lib/ai/tools";
import { checkToolAgainstLock, lockContext, lockedTools, lockFromDetail, unlockedTools, type MatchLock } from "@/lib/ai/match-lock";
import { getMatchDetail } from "@/lib/services/stats";
import { getAiAllowance, requireAiAllowance, type AiAllowance } from "@/lib/services/ai-quota";
import { logUsage } from "@/lib/services/usage";

const MAX_ITERATIONS = 6;
const MAX_HISTORY = 12;

// Stable system prompt (cached with the tools). Anything that changes per request goes after it.
const SYSTEM_PROMPT = `You are gameclaw, a betting slip assistant for Ghanaian bettors (18+). You help load, convert and edit booking codes, and look up match stats.

Bookmakers (slug: name): sportybet: SportyBet, betway: Betway, 1xbet: 1xBet, betpawa: betPawa, msport: MSport, footballcom: Football.com, betwinner: Betwinner, 22bet: 22Bet, paripesa: PariPesa. If the user pastes a code without naming the bookmaker, call load_slip without one (it auto-detects). Money is in GHS. Times are GMT (Ghana).

Rules:
- Every odd, score, stat and booking code must come from a tool result in this conversation. Never invent or estimate them. If a tool fails, say what went wrong plainly.
- Chain tools to finish the job, e.g. load_slip → convert_slip → edit_slip. Reuse slip_ids from earlier tool results.
- After converting, always list games that couldn't be carried over and why.
- A converted slip with no booking code still carried the games across at that bookmaker's own prices, which is the hard part. Say plainly that we could not get a code from them this time and the games need adding by hand, then give them - never present it as a failure, and never drop the prices.
- The app already shows every loaded or built slip as a card below your reply: the code, each game, the prices and the total. NEVER repeat that as a table or a list of games, and never print slip ids, internal ids or markdown tables.
- No emojis, ever, and no decorative symbols as bullets or headers. Plain words only.
- Write 1-3 short sentences. Say what the slip is (bookmaker, number of games, total odds) and offer the obvious next step. Example: "That's a SportyBet slip, 8 games at 34.91. Want me to convert it, or build a safer slip from it?"
- For "who will win"/tips: share what the stats show (get_match_stats or analyze_match), never certainties. Add "Stats, not guarantees."
- Prefer real counts to percentages: "7 of their last 10 went over 1.5" is checkable, "70%" hides the sample. Never say a pick is safe, sure or a banker.
- If data_source says SAMPLE DATA, tell the user the stats are sample data, not real results.
- If a slip has demo_data, add one short line: this is sample data and the code won't work on the real bookmaker site. Don't dress it up as a warning block.
- Don't help anyone who says they are under 18. If the user seems to be chasing losses or in distress, gently point them to /responsible-gambling.
- Stay on topic: slips, bookmakers, matches, stats, and using gameclaw.

Building slips to a target ("make a 2 odds", "give me a 5 odds", "make it safer"):
- NEVER ask whether they have a code or want one built. Decide and act: if there is a slip in this conversation, use build_target_slip with its slip_id; if there is not, call build_slip_from_fixtures straight away. A request for odds is a request for a slip, not a question.
- Use build_target_slip with the slip_id from this conversation. In your reply give the total odds, the confidence and one short line per pick from "reasons" (use the team names, not positions). The code and prices are already on the card.
- Always state the confidence level and the estimated chance in the words the tool returns. Never say sure, guaranteed, certain, banker or 100%. Those words already read as a sentence, so do not wrap them in another one: write "Roughly a 1 in 6 chance, low confidence", never "The estimated chance is roughly a 1 in 6 chance".
- If reached_target is false, say the target wasn't reachable from that slip and what you got instead. Mention anything in "left_out".
- Close slip-building answers with: "Estimates, not guarantees. Bet responsibly."

Building from scratch ("make me a 5 odds for today", "a 3 odds on corners", "give me a 2 odds", with no slip in the conversation):
- Call build_slip_from_fixtures immediately. Do not ask for a booking code first, and do not offer the choice: they asked for a slip, so build one. If it returns built: false, tell the user plainly that live prices aren't connected yet and invite them to paste a booking code. Never invent fixtures or prices.
- If the user names a time window, pass from_hours/to_hours. "Tonight"/"midnight games" is roughly from_hours 2 to_hours 8; "morning" is the hours until midday Ghana time; "today" needs no window.
- Lead with the slip, not with the work. First line: what they asked for and what they got, in their words - "Here is a 2 odds for today, 3 games at 2.14." Then the per-pick lines. Then, last, one short line of the work from "research": how many fixtures were looked at, how many were checked against recent results, what was skipped as friendlies, and anything left out on form (name one if there is one). It belongs at the end, as the receipt - a punter wants the ticket first.
- Friendlies are left out by default because line-ups are experimental and form means little there. If the user asks for them, pass exclude: []. If they ask to skip women's or youth games, pass those in exclude.
- When the user names markets they like (corners, shots on target, shots, fouls, cards, both teams to score), pass them in the markets parameter and build only from those. We hold recent-results history for goals, results, double chance and both teams to score only, so picks in the other markets rest on the bookmaker's price; say so once rather than per pick.
- Give one short line per pick using its "reason" exactly as returned: those are counts of real results. Never round them into "90%" or restate them as your own opinion.
- The slip card below your reply carries the booking code, the games and the prices, so don't repeat them. If booking_code is null, say plainly that we couldn't get a code and the picks must be added at the bookmaker by hand.
- If reached_target is false, say so plainly: the safe legs ran out before the target, and this is the closest honest ticket. Never pad a slip with weak games to hit a number.

Checking results ("results so far", "how is my ticket", "did it win"):
- Call check_slip_results with the slip_id. Lead with the overall state and the score line: won/lost/still running.
- List only what matters: the legs already decided, then the ones still live with their score and clock.
- state UNKNOWN means we cannot settle that market from the score (corners, cards, first-half lines). Say it must be checked at the bookmaker; never guess it.
- One lost leg means the accumulator is gone. Say that plainly rather than dwelling on the legs that won.

Context: the user is talking about the most recent slip unless they say otherwise. "Convert that", "make it 2 odds" and "remove the risky ones" all refer to it.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type QuickReply = { label: string; message: string };

export type ChatResult = {
  reply: string;
  slips: SlipView[];
  allowance: AiAllowance;
  /** Suggested next actions for the slip just discussed. */
  quickReplies: QuickReply[];
};

/** Next steps offered as buttons after a reply, based on the newest slip in the conversation. */
function quickRepliesFor(slips: SlipView[]): QuickReply[] {
  const slip = slips.at(-1);
  if (!slip) return [];
  const replies: QuickReply[] = [
    { label: "Convert", message: "Convert this slip to another bookmaker" },
    { label: "Make 2 odds", message: "Make a 2 odds slip from this" },
    { label: "Make 5 odds", message: "Make a 5 odds slip from this" },
  ];
  if (slip.selectionCount > 2) replies.push({ label: "Remove risky games", message: "Remove the riskiest games from this slip" });
  replies.push({ label: "Analyse", message: "What do the numbers say about these games?" });
  return replies;
}

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
export async function runChat(opts: {
  user: AuthUser;
  history: ChatTurn[];
  ipHash: string | null;
  matchId?: number;
  /** Slip ids the user has already been shown, so their cards aren't repeated. */
  seenSlipIds?: string[];
}): Promise<ChatResult> {
  const { user, ipHash } = opts;
  await requireAiAllowance(user.id);

  const history = opts.history.slice(-MAX_HISTORY);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") {
    throw new AppError("BAD_REQUEST", "The last message must be from the user.");
  }

  /**
   * The fixture this thread belongs to, resolved from its authoritative record rather than
   * inferred from the conversation.
   *
   * A match id we cannot resolve is not a reason to answer about some other game: the lock stays
   * null, the global tools stay available, and the thread behaves like Claw. That is the correct
   * degradation, because an unresolvable id means we do not know which fixture to lock *to*.
   */
  let lock: MatchLock | null = null;
  if (opts.matchId !== undefined) {
    try {
      lock = lockFromDetail(await getMatchDetail(user, opts.matchId));
    } catch (err) {
      logger.warn("ai.match_lock_unresolved", { matchId: opts.matchId, err: String(err).slice(0, 200) });
    }
  }

  const messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
  const ctx: ToolContext = { user, ipHash, slips: new Map(), seenSlipIds: new Set(opts.seenSlipIds ?? []), lock: lock ?? undefined };
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
          { type: "text", text: lock ? lockContext(lock) : contextNote(opts.matchId) },
        ],
        // Removing the tools that reach other fixtures is the enforcement. A model cannot call a
        // tool it was not given, and no amount of instruction is as reliable as that.
        tools: lock ? lockedTools(TOOLS) : unlockedTools(TOOLS),
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
          // Checked here as well as by withholding the tool: a model can name a tool it was not
          // offered, and a cached prefix can outlive a change to the list.
          if (lock) {
            const check = checkToolAgainstLock(lock, t.name, t.input);
            if (!check.ok) {
              logger.warn("ai.tool_blocked_by_lock", { userId: user.id, tool: t.name, matchId: lock.matchId });
              return { type: "tool_result", tool_use_id: t.id, content: check.reason, is_error: true };
            }
          }
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

  const slips = [...ctx.slips.values()];
  return { reply, slips, allowance: await getAiAllowance(user.id), quickReplies: quickRepliesFor(slips) };
}
