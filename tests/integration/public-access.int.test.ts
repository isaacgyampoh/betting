import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { optionalAdult } from "@/lib/auth";
import { enforceRateLimit, meterPublicBrowse, PUBLIC_BROWSE_LIMIT } from "@/lib/services/usage";
import { createUser } from "./helpers";

/**
 * Scores, fixtures, tables and the match centre are the reason to open the app. A registration
 * wall in front of them is a wall in front of the product. What must survive opening them up is
 * the provider quota behind them, which is a few hundred requests a minute shared by everybody.
 */
describe("the football pages are open, and still bounded", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a visitor with no credentials is a visitor, not an error", async () => {
    await expect(optionalAdult(null)).resolves.toEqual({ user: null, profile: null });
    await expect(optionalAdult("Bearer not.a.jwt")).resolves.toEqual({ user: null, profile: null });
  });

  // An expired session mid-browse should drop to the public experience, not throw a wall.
  it("a token that does not verify degrades to the public experience", async () => {
    await expect(optionalAdult("Bearer eyJhbGciOiJIUzI1NiJ9.e30.x")).resolves.toEqual({ user: null, profile: null });
  });

  it("counts a visitor by address, and writes the row that makes the count real", async () => {
    const ip = `test-hash-${Date.now()}`;
    await db.usageLog.deleteMany({ where: { ipHash: ip } });

    await meterPublicBrowse(null, ip);
    await meterPublicBrowse(null, ip);

    expect(await db.usageLog.count({ where: { ipHash: ip, kind: "STATS" } })).toBe(2);
  });

  it("refuses an address that has read its hourly fill", async () => {
    const ip = `test-flood-${Date.now()}`;
    await db.usageLog.createMany({
      data: Array.from({ length: PUBLIC_BROWSE_LIMIT.limit }, () => ({ ipHash: ip, kind: "STATS" as const, success: true })),
    });

    await expect(meterPublicBrowse(null, ip)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  // The match centre already records its own usage against the user. A second row here would
  // quietly halve the allowance they were given.
  it("does not double-count a signed-in reader", async () => {
    const user = await createUser();
    await db.usageLog.deleteMany({ where: { userId: user.id } });

    await meterPublicBrowse(user.id, "some-address-hash");

    expect(await db.usageLog.count({ where: { userId: user.id } })).toBe(0);
  });

  it("has nobody to bill when there is neither a user nor an address", async () => {
    await expect(
      enforceRateLimit({ userId: null, ipHash: null, kind: "STATS", limit: 0, windowMs: 1000 }),
    ).resolves.toBeUndefined();
  });

  it("keeps a signed-in reader's own budget separate from an address", async () => {
    const user = await createUser();
    const ip = `test-sep-${Date.now()}`;
    await db.usageLog.createMany({
      data: Array.from({ length: PUBLIC_BROWSE_LIMIT.limit }, () => ({ ipHash: ip, kind: "STATS" as const, success: true })),
    });

    // The address is spent, but this reader is identified and is counted on their own id.
    await expect(meterPublicBrowse(user.id, ip)).resolves.toBeUndefined();
  });
});
