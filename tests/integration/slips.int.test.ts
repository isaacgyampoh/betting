import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/bookmakers/registry";
import { convertSlip } from "@/lib/services/convert";
import { editSlip } from "@/lib/services/edit";
import { getSlip, listRecentSlips, loadSlip } from "@/lib/services/slips";
import { createUser } from "./helpers";

describe("auth trigger", () => {
  it("creates a profile for each new auth user", async () => {
    const user = await createUser();
    const profile = await db.profile.findUnique({ where: { id: user.id } });
    expect(profile).toMatchObject({ email: user.email, displayName: "Test User", freeAiCredits: 5 });
  });
});

describe("load slip", () => {
  it("loads, saves, caches and lists", async () => {
    const user = await createUser();
    const slip = await loadSlip({ user, bookmaker: "sportybet", code: " bc7k2q ", ipHash: "h" });
    expect(slip.code).toBe("BC7K2Q");
    expect(slip.selectionCount).toBe(8);
    expect(slip.totalOdds).toBeGreaterThan(10);
    expect(slip.warnings).toEqual([]);

    await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: "h" });
    const logs = await db.usageLog.findMany({ where: { userId: user.id, kind: "SLIP_LOAD" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => (l.meta as { cached: boolean }).cached)).toEqual([false, true]);

    const recent = await listRecentSlips(user);
    expect(recent).toHaveLength(2);
    expect((await getSlip(user, slip.id)).selections).toHaveLength(8);
  });

  it("returns warnings for started games and unsupported markets", async () => {
    const user = await createUser();
    const slip = await loadSlip({ user, bookmaker: "betway", code: "BWLIVE", ipHash: null });
    expect(slip.warnings.map((w) => w.code).sort()).toEqual(["STARTED", "UNMAPPED_MARKET"]);
  });

  it.each([
    ["BCEXP1", "EXPIRED_CODE"],
    ["NOPE99", "INVALID_CODE"],
    ["a!", "INVALID_CODE"],
    ["BCDOWN", "BOOKMAKER_UNAVAILABLE"],
  ])("%s → %s, and the failure is logged", async (code, errorCode) => {
    const user = await createUser();
    await expect(loadSlip({ user, bookmaker: "sportybet", code, ipHash: null })).rejects.toMatchObject({ code: errorCode });
    const log = await db.usageLog.findFirst({ where: { userId: user.id } });
    expect(log).toMatchObject({ success: false, errorCode });
  });

  it("rate limits loads per user", async () => {
    const user = await createUser();
    await db.usageLog.createMany({ data: Array.from({ length: 30 }, () => ({ userId: user.id, kind: "SLIP_LOAD" as const })) });
    await expect(loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("does not show other users' slips", async () => {
    const a = await createUser();
    const b = await createUser();
    const slip = await loadSlip({ user: a, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    await expect(getSlip(b, slip.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("convert slip", () => {
  it("converts SportyBet → Betway, lists the unmatched game, and books a working code", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const converted = await convertSlip({ user, source: { slipId: source.id }, target: "betway", ipHash: null });

    expect(converted.bookmaker.slug).toBe("betway");
    expect(converted.parent?.id).toBe(source.id);
    expect(converted.selectionCount).toBe(7);
    const missing = converted.selections.filter((s) => s.status !== "OK");
    expect(missing).toEqual([expect.objectContaining({ home: "Nations FC", status: "EVENT_NOT_FOUND" })]);
    expect(converted.warnings[0].code).toBe("NOT_CONVERTED");
    expect(converted.selections.find((s) => s.position === 1)).toMatchObject({ home: "Man Utd", sourceOdds: expect.any(Number) });

    const booked = await getAdapter("betway").loadCode(converted.code!);
    expect(booked.selections).toHaveLength(7);

    // Canonical events linked across both bookmakers, and Betway spellings learned as aliases.
    const linked = await db.bookmakerEvent.count({ where: { eventId: { not: null } } });
    expect(linked).toBeGreaterThanOrEqual(14);
    expect(await db.teamAlias.findFirst({ where: { alias: "Man Utd" } })).not.toBeNull();
  });

  it("converts directly from a code, and explains started / unsupported picks", async () => {
    const user = await createUser();
    const converted = await convertSlip({ user, source: { bookmaker: "sportybet", code: "BCLIVE" }, target: "betway", ipHash: null });
    const statuses = Object.fromEntries(converted.selections.map((s) => [s.position, s.status]));
    expect(statuses).toEqual({ 1: "EVENT_STARTED", 2: "OK", 3: "OK", 4: "UNSUPPORTED_MARKET" });
  });

  it("refuses converting to the same bookmaker", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "betway", code: "BW5V8N", ipHash: null });
    await expect(convertSlip({ user, source: { slipId: source.id }, target: "betway", ipHash: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("edit slip", () => {
  it("keeps the safest N and books a new code", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const [edited] = await editSlip({ user, slipId: source.id, op: { type: "safest", count: 3 }, book: true, ipHash: null });
    expect(edited.selectionCount).toBe(3);
    expect(edited.code).toMatch(/^BC/);
    expect(edited.totalOdds!).toBeLessThan(source.totalOdds!);
    const sourceOdds = source.selections.map((s) => s.odds!).sort((a, b) => a - b).slice(0, 3);
    expect(edited.selections.map((s) => s.odds).sort()).toEqual(sourceOdds.sort());
  });

  it("splits into balanced slips with their own codes", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BC7K2Q", ipHash: null });
    const parts = await editSlip({ user, slipId: source.id, op: { type: "split", parts: 3 }, book: true, ipHash: null });
    expect(parts).toHaveLength(3);
    expect(parts.reduce((n, p) => n + p.selectionCount, 0)).toBe(8);
    expect(new Set(parts.map((p) => p.code)).size).toBe(3);
  });

  it("trims to target odds and skips started games", async () => {
    const user = await createUser();
    const source = await loadSlip({ user, bookmaker: "sportybet", code: "BCLIVE", ipHash: null });
    const [trimmed] = await editSlip({ user, slipId: source.id, op: { type: "trim", targetOdds: 3 }, book: true, ipHash: null });
    expect(trimmed.totalOdds!).toBeLessThanOrEqual(3);
    expect(trimmed.selections.some((s) => s.home === "Bechem United")).toBe(false);
  });
});
