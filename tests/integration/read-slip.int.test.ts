import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createUser } from "./helpers";

const calls: Anthropic.MessageCreateParams[] = [];
let respond: (params: Anthropic.MessageCreateParams) => Partial<Anthropic.Message>;
const create = async (params: Anthropic.MessageCreateParams) => {
  calls.push(structuredClone(params));
  return respond(params);
};
vi.mock("@/lib/ai/client", () => ({ anthropic: () => ({ messages: { create }, beta: { messages: { create } } }) }));

const usage = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage;
const extraction = (input: unknown): Partial<Anthropic.Message> => ({
  stop_reason: "tool_use",
  model: "claude-haiku-4-5",
  content: [{ type: "tool_use", id: "t1", name: "record_slip", input } as Anthropic.ToolUseBlock],
  usage,
});

const pngPixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(() => {
  calls.length = 0;
  process.env.ANTHROPIC_API_KEY = "test";
});

describe("reading a slip from a screenshot", () => {
  it("extracts rows, matches them to real fixtures and reports what needs checking", async () => {
    const { readSlipFile } = await import("@/lib/services/read-slip");
    const user = await createUser();
    respond = () =>
      extraction({
        is_betting_slip: true,
        bookmaker: "SportyBet",
        booking_code: "AB12CD",
        total_odds: 4.2,
        rows: [
          { home: "Manchester United", away: "Tottenham", market: "1X2", pick: "Manchester United", odds: 2.1, confidence: "high" },
          { home: "Blurry FC", away: "Unknown United", market: "1X2", pick: "Blurry FC", odds: 2.0, confidence: "low" },
        ],
        notes: null,
      });

    const read = await readSlipFile({ user, file: { data: pngPixel, mediaType: "image/png" }, ipHash: null });
    expect(read.bookmaker).toBe("SportyBet");
    expect(read.bookingCode).toBe("AB12CD");
    expect(read.rows).toHaveLength(2);
    expect(read.rows[0].match?.home).toBe("Manchester United");
    expect(read.rows[0].needsConfirmation).toBeNull();
    expect(read.rows[1].needsConfirmation).toMatch(/couldn't find this fixture|hard to read/);
    expect(read.clean).toBe(false);
    expect(read.totalOddsComputed).toBe(4.2);

    // the image reached the model as an image block, with the transcription tool offered
    const content = calls[0].messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
    expect(calls[0].tools?.[0]).toMatchObject({ name: "record_slip" });
  });

  it("rejects images that aren't betting slips", async () => {
    const { readSlipFile } = await import("@/lib/services/read-slip");
    const user = await createUser();
    respond = () => extraction({ is_betting_slip: false, bookmaker: null, booking_code: null, total_odds: null, rows: [], notes: "A photo of a cat." });
    await expect(readSlipFile({ user, file: { data: pngPixel, mediaType: "image/png" }, ipHash: null })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("doesn't look like a betting slip"),
    });
  });

  it("rejects unsupported file types and oversized files", async () => {
    const { readSlipFile } = await import("@/lib/services/read-slip");
    const user = await createUser();
    respond = () => extraction({ is_betting_slip: true, bookmaker: null, booking_code: null, total_odds: null, rows: [], notes: null });
    await expect(readSlipFile({ user, file: { data: pngPixel, mediaType: "text/csv" }, ipHash: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const big = Buffer.alloc(5 * 1024 * 1024).toString("base64");
    await expect(readSlipFile({ user, file: { data: big, mediaType: "image/png" }, ipHash: null })).rejects.toMatchObject({
      message: expect.stringContaining("too big"),
    });
  });

  it("accepts a PDF as a document block", async () => {
    const { readSlipFile } = await import("@/lib/services/read-slip");
    const user = await createUser();
    respond = () =>
      extraction({
        is_betting_slip: true,
        bookmaker: null,
        booking_code: null,
        total_odds: null,
        rows: [{ home: "Arsenal", away: "Newcastle", market: "1X2", pick: "Arsenal", odds: 1.6, confidence: "high" }],
        notes: null,
      });
    await readSlipFile({ user, file: { data: pngPixel, mediaType: "application/pdf" }, ipHash: null });
    const content = calls[0].messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
  });
});
