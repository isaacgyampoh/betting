import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AuthUser } from "@/lib/auth";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";
import { AppError } from "@/lib/errors";
import type { EditOp } from "@/lib/slips/edit";
import type { SlipView } from "@/lib/slips/view";
import { analyzeMatch } from "@/lib/ai/analysis";
import { compactMatch, compactMatchDetail, compactSlip } from "@/lib/ai/compact";
import { convertSlip } from "@/lib/services/convert";
import { editSlip } from "@/lib/services/edit";
import { getSlip, listRecentSlips, loadSlip } from "@/lib/services/slips";
import { getMatchDetail, lookupMatch, searchMatches } from "@/lib/services/stats";

// Tool definitions are static and sorted, so the tools prefix stays byte-identical across
// requests (prompt caching). Descriptions are short to keep tokens down.

const bookmaker = { type: "string", enum: [...BOOKMAKER_SLUGS], description: "Bookmaker slug" } as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "analyze_match",
    description:
      "Deep AI analysis of a match from its stats (paid plans only). Use only when the user asks for an analysis, prediction or 'what do you think' about a specific match. Needs match_id from find_matches.",
    input_schema: { type: "object", properties: { match_id: { type: "integer" }, date: { type: "string" } }, required: ["match_id"] },
  },
  {
    name: "convert_slip",
    description:
      "Convert a slip to another bookmaker and book a new code. Pass slip_id (preferred) or bookmaker+code. Games that can't be matched are returned with a reason; report them to the user.",
    input_schema: {
      type: "object",
      properties: { target: bookmaker, slip_id: { type: "string" }, bookmaker, code: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "edit_slip",
    description:
      "Edit a slip and book new code(s). action=remove (positions), safest (count: keep N lowest-odds picks), trim (target_odds: drop riskiest picks until total odds <= target), max_odds (max_odds: remove every pick with odds above this), split (parts).",
    input_schema: {
      type: "object",
      properties: {
        slip_id: { type: "string" },
        action: { type: "string", enum: ["remove", "safest", "trim", "max_odds", "split"] },
        positions: { type: "array", items: { type: "integer" } },
        count: { type: "integer" },
        target_odds: { type: "number" },
        max_odds: { type: "number" },
        parts: { type: "integer" },
      },
      required: ["slip_id", "action"],
    },
  },
  {
    name: "find_matches",
    description: "Find upcoming/today's matches for a team (optionally vs an opponent). Returns match_ids for get_match_stats.",
    input_schema: { type: "object", properties: { team: { type: "string" }, opponent: { type: "string" } }, required: ["team"] },
  },
  {
    name: "get_match_stats",
    description: "Recent form, head-to-head, standings and key numbers for a match_id. Use for any stats question. Pass date (YYYY-MM-DD of the kickoff from find_matches) when known.",
    input_schema: { type: "object", properties: { match_id: { type: "integer" }, date: { type: "string" } }, required: ["match_id"] },
  },
  {
    name: "get_slip",
    description: "Get a slip the user loaded earlier by slip_id.",
    input_schema: { type: "object", properties: { slip_id: { type: "string" } }, required: ["slip_id"] },
  },
  {
    name: "list_recent_slips",
    description: "List the user's most recent slips (ids, codes, bookmaker, total odds).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "load_slip",
    description: "Load a booking code. Omit bookmaker to auto-detect it. Returns games, markets, odds, total odds and a slip_id for later tools. If the bookmaker is ambiguous, ask the user which one.",
    input_schema: { type: "object", properties: { bookmaker, code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "stats_for_slip_game",
    description: "Stats for one game on a slip, found by team names and kickoff (ISO) from the slip.",
    input_schema: {
      type: "object",
      properties: { home: { type: "string" }, away: { type: "string" }, kickoff: { type: "string" } },
      required: ["home", "away", "kickoff"],
    },
  },
];

const slug = z.enum(BOOKMAKER_SLUGS);
const uuid = z.uuid({ message: "slip_id must be a slip_id returned by an earlier tool" });

const SCHEMAS = {
  load_slip: z.object({ bookmaker: slug.optional(), code: z.string().min(1).max(40) }),
  convert_slip: z.object({ target: slug, slip_id: uuid.optional(), bookmaker: slug.optional(), code: z.string().max(40).optional() }),
  edit_slip: z.object({
    slip_id: uuid,
    action: z.enum(["remove", "safest", "trim", "max_odds", "split"]),
    positions: z.array(z.number().int().min(1)).optional(),
    count: z.number().int().min(1).optional(),
    target_odds: z.number().min(1.01).optional(),
    max_odds: z.number().min(1.01).optional(),
    parts: z.number().int().min(2).max(10).optional(),
  }),
  get_slip: z.object({ slip_id: uuid }),
  list_recent_slips: z.object({}),
  find_matches: z.object({ team: z.string().min(2).max(60), opponent: z.string().max(60).optional() }),
  get_match_stats: z.object({ match_id: z.number().int().positive(), date: z.iso.date().optional() }),
  stats_for_slip_game: z.object({ home: z.string().min(1), away: z.string().min(1), kickoff: z.iso.datetime({ offset: true }) }),
  analyze_match: z.object({ match_id: z.number().int().positive(), date: z.iso.date().optional() }),
} as const;

export type ToolName = keyof typeof SCHEMAS;

export type ToolContext = { user: AuthUser; ipHash: string | null; slips: Map<string, SlipView> };

async function toEditOp(input: z.infer<(typeof SCHEMAS)["edit_slip"]>, ctx: ToolContext): Promise<EditOp> {
  const need = <T,>(v: T | undefined, field: string): T => {
    if (v === undefined) throw new AppError("BAD_REQUEST", `${field} is required for action ${input.action}`);
    return v;
  };
  switch (input.action) {
    case "remove":
      return { type: "remove", positions: need(input.positions, "positions") };
    case "safest":
      return { type: "safest", count: need(input.count, "count") };
    case "trim":
      return { type: "trim", targetOdds: need(input.target_odds, "target_odds") };
    case "split":
      return { type: "split", parts: need(input.parts, "parts") };
    case "max_odds": {
      const max = need(input.max_odds, "max_odds");
      const slip = await getSlip(ctx.user, input.slip_id);
      const positions = slip.selections.filter((s) => s.status === "OK" && s.odds !== null && s.odds > max).map((s) => s.position);
      if (!positions.length) throw new AppError("BAD_REQUEST", `No picks have odds above ${max}; nothing to remove.`);
      return { type: "remove", positions };
    }
  }
}

function remember(ctx: ToolContext, ...slips: SlipView[]) {
  for (const s of slips) ctx.slips.set(s.id, s);
}

/** Runs one tool call. Returns JSON for the model; AppErrors become is_error results the model can explain. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const schema = SCHEMAS[name as ToolName];
  if (!schema) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { content: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };

  try {
    const result = await execute(name as ToolName, parsed.data, ctx);
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    if (err instanceof AppError) return { content: `${err.code}: ${err.message}`, isError: true };
    throw err;
  }
}

async function execute(name: ToolName, input: unknown, ctx: ToolContext): Promise<unknown> {
  const { user, ipHash } = ctx;
  switch (name) {
    case "load_slip": {
      const i = input as z.infer<(typeof SCHEMAS)["load_slip"]>;
      const slip = await loadSlip({ user, ipHash, bookmaker: i.bookmaker, code: i.code });
      remember(ctx, slip);
      return compactSlip(slip);
    }
    case "convert_slip": {
      const i = input as z.infer<(typeof SCHEMAS)["convert_slip"]>;
      const source = i.slip_id
        ? { slipId: i.slip_id }
        : i.code
          ? { bookmaker: i.bookmaker, code: i.code }
          : null;
      if (!source) throw new AppError("BAD_REQUEST", "Pass slip_id, or bookmaker and code.");
      const slip = await convertSlip({ user, ipHash, source, target: i.target });
      remember(ctx, slip);
      return compactSlip(slip);
    }
    case "edit_slip": {
      const i = input as z.infer<(typeof SCHEMAS)["edit_slip"]>;
      const slips = await editSlip({ user, ipHash, slipId: i.slip_id, op: await toEditOp(i, ctx), book: true });
      remember(ctx, ...slips);
      return slips.map(compactSlip);
    }
    case "get_slip": {
      const slip = await getSlip(user, (input as { slip_id: string }).slip_id);
      remember(ctx, slip);
      return compactSlip(slip);
    }
    case "list_recent_slips":
      return (await listRecentSlips(user, 5)).map((s) => ({ slip_id: s.id, bookmaker: s.bookmaker.name, code: s.code, games: s.selectionCount, total_odds: s.totalOdds, created: s.createdAt }));
    case "find_matches": {
      const i = input as z.infer<(typeof SCHEMAS)["find_matches"]>;
      const matches = await searchMatches(i.team, i.opponent);
      return matches.length ? matches.map(compactMatch) : { found: 0, note: "No matching fixtures in the next few days." };
    }
    case "get_match_stats":
      const i = input as { match_id: number; date?: string };
      return compactMatchDetail(await getMatchDetail(user, i.match_id, i.date));
    case "stats_for_slip_game": {
      const i = input as z.infer<(typeof SCHEMAS)["stats_for_slip_game"]>;
      const match = await lookupMatch(i.home, i.away, new Date(i.kickoff));
      if (!match) throw new AppError("NOT_FOUND", "No stats found for this game (league may not be covered).");
      return compactMatchDetail(await getMatchDetail(user, match.id, match.kickoffAt.slice(0, 10)));
    }
    case "analyze_match": {
      const i = input as { match_id: number; date?: string };
      const r = await analyzeMatch(user, i.match_id, i.date);
      return { analysis: r.analysis, data_source: r.source === "sample" ? "SAMPLE DATA" : "API-Football" };
    }
  }
}
