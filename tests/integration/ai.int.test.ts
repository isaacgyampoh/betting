import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { createUser } from "./helpers";

// Scripted model: `respond` decides each reply (it can read earlier tool results); requests are recorded.
const calls: Anthropic.MessageCreateParams[] = [];
let respond: (params: Anthropic.MessageCreateParams, n: number) => Partial<Anthropic.Message>;
const create = async (params: Anthropic.MessageCreateParams) => {
  calls.push(structuredClone(params));
  return respond(params, calls.length);
};
vi.mock("@/lib/ai/client", () => ({ anthropic: () => ({ messages: { create }, beta: { messages: { create } } }) }));

/** The JSON of the most recent tool result sent to the model. */
const lastToolResult = (params: Anthropic.MessageCreateParams) =>
  JSON.parse((params.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0].content as string);

const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) as Anthropic.Usage;
const toolUse = (id: string, name: string, input: unknown): Partial<Anthropic.Message> => ({
  stop_reason: "tool_use",
  model: "claude-haiku-4-5",
  content: [{ type: "tool_use", id, name, input } as Anthropic.ToolUseBlock],
  usage: usage(1000, 50),
});
const final = (text: string): Partial<Anthropic.Message> => ({
  stop_reason: "end_turn",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text } as Anthropic.TextBlock],
  usage: usage(1500, 120),
});

beforeEach(() => {
  calls.length = 0;
  process.env.ANTHROPIC_API_KEY = "test";
});

describe("AI chat agent", () => {
  it("chains tools (load → convert → edit), meters usage and spends one trial credit", async () => {
    const { runChat } = await import("@/lib/ai/agent");
    const user = await createUser();

    respond = (params, n) => {
      if (n === 1) return toolUse("t1", "load_slip", { bookmaker: "sportybet", code: "BC7K2Q" });
      const prev = lastToolResult(params);
      if (n === 2) return toolUse("t2", "convert_slip", { slip_id: prev.slip_id, target: "betway" });
      if (n === 3) return toolUse("t3", "edit_slip", { slip_id: prev.slip_id, action: "max_odds", max_odds: 2.0 });
      return final(`Done. New Betway code: ${prev[0].code}`);
    };
    const r = await runChat({ user, ipHash: null, history: [{ role: "user", content: "Convert SportyBet BC7K2Q to Betway and drop anything above 2.0" }] });
    expect(r.reply).toMatch(/New Betway code: BW/);
    expect(r.slips.map((s) => `${s.bookmaker.slug}:${s.kind}`)).toEqual(["sportybet:LOADED", "betway:CONVERTED", "betway:EDITED"]);
    const edited = r.slips[2];
    expect(edited.selections.every((s) => (s.odds ?? 0) <= 2.0)).toBe(true);

    // Stable prefix for caching: same tools and first system block on every call.
    expect(new Set(calls.map((c) => JSON.stringify([c.tools, (c.system as Anthropic.TextBlockParam[])[0]]))).size).toBe(1);
    expect(calls[0].cache_control).toEqual({ type: "ephemeral" });

    const log = await db.usageLog.findFirst({ where: { userId: user.id, kind: "AI_CHAT" } });
    expect(log).toMatchObject({ success: true, model: "claude-haiku-4-5", inputTokens: 4500, outputTokens: 270 });
    expect(log!.costMicroUsd).toBe(4500 * 1 + 270 * 5);
    expect((await db.profile.findUnique({ where: { id: user.id } }))!.freeAiCredits).toBe(4);
    expect(r.allowance).toMatchObject({ kind: "trial", remaining: 4 });
  });

  it("returns tool errors to the model instead of failing the request", async () => {
    const { runChat } = await import("@/lib/ai/agent");
    const user = await createUser();
    respond = (_p, n) => (n === 1 ? toolUse("t1", "load_slip", { bookmaker: "sportybet", code: "BCEXP1" }) : final("That code has expired."));
    const r = await runChat({ user, ipHash: null, history: [{ role: "user", content: "load BCEXP1" }] });
    expect(r.reply).toBe("That code has expired.");
    const toolResult = (calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResult).toMatchObject({ is_error: true, content: expect.stringContaining("EXPIRED_CODE") });
  });

  it("blocks requests when trial credits are used up", async () => {
    const { runChat } = await import("@/lib/ai/agent");
    const user = await createUser();
    await db.profile.update({ where: { id: user.id }, data: { freeAiCredits: 0 } });
    await expect(runChat({ user, ipHash: null, history: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
    expect(calls).toHaveLength(0);
  });

  it("enforces plan daily limits", async () => {
    const { runChat } = await import("@/lib/ai/agent");
    const user = await createUser();
    const plan = await db.plan.findUniqueOrThrow({ where: { code: "daily" } });
    await db.subscription.create({ data: { userId: user.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000) } });
    await db.usageLog.createMany({ data: Array.from({ length: plan.dailyAiRequests }, () => ({ userId: user.id, kind: "AI_CHAT" as const })) });
    await expect(runChat({ user, ipHash: null, history: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });
  });
});

describe("deep analysis", () => {
  it("requires a plan with analysis, then caches the result across users", async () => {
    const { analyzeMatch } = await import("@/lib/ai/analysis");
    const { searchMatches } = await import("@/lib/services/stats");
    const [match] = await searchMatches("Arsenal");
    const trialUser = await createUser();
    await expect(analyzeMatch(trialUser, match.id)).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });

    const weekly = await db.plan.findUniqueOrThrow({ where: { code: "weekly" } });
    const subscribe = async () => {
      const u = await createUser();
      await db.subscription.create({ data: { userId: u.id, planId: weekly.id, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000) } });
      return u;
    };
    await db.statsCache.deleteMany({ where: { endpoint: "analysis" } });
    respond = () => ({ stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "text", text: "Arsenal lean. Stats, not guarantees." } as Anthropic.TextBlock], usage: usage(3000, 400) });

    const a = await analyzeMatch(await subscribe(), match.id);
    expect(a).toMatchObject({ cached: false, analysis: expect.stringContaining("Stats, not guarantees") });
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "medium" } });
    expect(JSON.parse(calls[0].messages[0].content as string).data_source).toBe("SAMPLE DATA (not real results)");

    const b = await analyzeMatch(await subscribe(), match.id);
    expect(b.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
