import { describe, expect, it, vi } from "vitest";
import { detectBookmaker } from "@/lib/bookmakers/detect";
import { createAdapter, modeEnvVar } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS, type BookmakerSlug } from "@/lib/bookmakers/types";

const adapters = BOOKMAKER_SLUGS.map((s) => createAdapter(s, "mock", { latencyMs: 0 }));
const bySlug = new Map(adapters.map((a) => [a.slug, a]));
const load = (slug: BookmakerSlug, code: string) => bySlug.get(slug)!.loadCode(code);

describe("bookmaker auto-detection", () => {
  it.each([
    ["BC7K2Q", "sportybet"],
    ["bw5v8n", "betway"],
    ["7KQ2M", "1xbet"],
    ["BP7431", "betpawa"],
    ["MS6120", "msport"],
    ["FB2Q7X", "footballcom"],
    ["WN83K", "betwinner"],
    ["22QW7", "22bet"],
    ["PP51Q", "paripesa"],
  ])("%s → %s", async (code, slug) => {
    const r = await detectBookmaker(code, adapters, load);
    expect(r).toMatchObject({ kind: "found", slug });
  });

  it("asks when a code is valid on more than one bookmaker", async () => {
    const r = await detectBookmaker("SHARED7", adapters, load);
    expect(r.kind).toBe("ambiguous");
    expect(r.kind === "ambiguous" && [...r.slugs].sort()).toEqual(["betwinner", "paripesa"]);
  });

  it("uses the code format first: bookmakers whose format can't match are never queried", async () => {
    const spy = vi.fn(load);
    await detectBookmaker("7K2M", adapters, spy).catch(() => {}); // 4 characters: only the 1xBet-platform format allows it
    expect(new Set(spy.mock.calls.map(([slug]) => slug))).toEqual(new Set(["1xbet", "betwinner", "22bet", "paripesa"]));
  });

  it("reports the most useful error when no bookmaker has the code", async () => {
    await expect(detectBookmaker("WNEXP1", adapters, load)).rejects.toMatchObject({ code: "EXPIRED_CODE" });
    await expect(detectBookmaker("BCDOWN", adapters, load)).rejects.toMatchObject({ code: "BOOKMAKER_UNAVAILABLE", message: expect.stringContaining("SportyBet") });
    await expect(detectBookmaker("NOPE99", adapters, load)).rejects.toMatchObject({ code: "BOOKMAKER_NOT_CONNECTED", message: expect.stringContaining("probably fine") });
    await expect(detectBookmaker("a!", adapters, load)).rejects.toMatchObject({ code: "INVALID_CODE", message: expect.stringContaining("doesn't look like") });
  });

  it("env var names are valid for every bookmaker", () => {
    for (const s of BOOKMAKER_SLUGS) expect(modeEnvVar(s)).toMatch(/^[A-Z][A-Z0-9_]*_MODE$/);
    expect(modeEnvVar("1xbet")).toBe("ONEXBET_MODE");
    expect(modeEnvVar("22bet")).toBe("TWENTYTWOBET_MODE");
  });
});
