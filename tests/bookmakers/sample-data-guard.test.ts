import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";

// Production must never serve an invented slip, price or booking code. The mocks exist so the app
// is exercisable locally, and this is the switch that keeps them out of production.

const ENV = { ...process.env };

async function registry() {
  vi.resetModules();
  return import("@/lib/bookmakers/registry");
}

beforeEach(() => {
  process.env.MOCK_LATENCY_MS = "0";
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("sampleDataAllowed", () => {
  it("is off in production unless explicitly turned on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SAMPLE_DATA", "");
    expect((await registry()).sampleDataAllowed()).toBe(false);
  });

  it("is on outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_SAMPLE_DATA", "");
    expect((await registry()).sampleDataAllowed()).toBe(true);
  });

  it("can be forced either way", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SAMPLE_DATA", "1");
    expect((await registry()).sampleDataAllowed()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_SAMPLE_DATA", "0");
    expect((await registry()).sampleDataAllowed()).toBe(false);
  });
});

describe("in production, an unconnected bookmaker serves nothing", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SAMPLE_DATA", "0");
  });

  it.each(BOOKMAKER_SLUGS.filter((s) => s !== "sportybet"))("%s refuses instead of returning sample data", async (slug) => {
    const { getAdapter } = await registry();
    const a = getAdapter(slug);
    expect(a.capabilities).toEqual({ loadCode: false, createCode: false, events: false });
    // "BC7K2Q" and friends are sample codes; in production they must not resolve to a slip.
    for (const call of [
      () => a.loadCode("BC7K2Q"),
      () => a.createCode([]),
      () => a.searchEvent("Arsenal", "Chelsea", new Date()),
      () => a.getEventMarkets("sr:match:1"),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "BOOKMAKER_NOT_CONNECTED" });
    }
  });

  it("still detects which bookmaker a code belongs to, so the user is told something useful", async () => {
    const { getAdapter } = await registry();
    // Pure functions stay available even when we cannot reach the bookmaker.
    expect(getAdapter("betway").normalizeCode(" bw5v8n ")).toBe("BW5V8N");
    expect(
      getAdapter("betway").mapMarket({ marketId: "Match Result (1X2)", outcomeId: "Draw", specifier: "" }, { home: "A", away: "B" }),
    ).toEqual({
      type: "MATCH_RESULT",
      period: "FT",
      outcome: "DRAW",
      line: null,
    });
  });

  it("lists only genuinely connected bookmakers", async () => {
    vi.stubEnv("SPORTYBET_MODE", "live");
    const { connectedBookmakers } = await registry();
    expect(connectedBookmakers().map((a) => a.slug)).toEqual(["sportybet"]);
  });

  it("lists none when nothing is connected", async () => {
    vi.stubEnv("SPORTYBET_MODE", "mock");
    const { connectedBookmakers } = await registry();
    expect(connectedBookmakers()).toEqual([]);
  });
});
