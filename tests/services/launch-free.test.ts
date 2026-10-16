import { describe, expect, it } from "vitest";
import { LAUNCH, everythingIsFree } from "@/lib/launch";

/**
 * Everything GameClaw can do is free for launch, decided in one place so paid plans come back
 * with one edit. Free is not unlimited: behind these features are Anthropic's bill and an
 * API-Football key that allows a few hundred requests a minute for the whole product, so a daily
 * ceiling is what stops one enthusiastic afternoon taking the football data down for everybody.
 */
describe("the launch giveaway", () => {
  it("is on", () => {
    expect(everythingIsFree()).toBe(true);
  });

  it("withholds no feature that used to need a plan", () => {
    expect(LAUNCH.allowDeepAnalysis).toBe(true);
    expect(LAUNCH.allowDailyPicks).toBe(true);
  });

  it("still has a ceiling on every metered feature", () => {
    const limits = Object.entries(LAUNCH.limits);
    expect(limits.length).toBeGreaterThan(0);
    for (const [name, value] of limits) {
      expect(value, `${name} must be a real ceiling, not unlimited`).toBeGreaterThan(0);
      expect(Number.isFinite(value), `${name} must be finite`).toBe(true);
    }
  });

  // Generous enough that no real session reaches it, low enough that nothing runs away.
  it("is far more generous than the old free plan, and still bounded", () => {
    expect(LAUNCH.limits.dailyAiRequests).toBeGreaterThanOrEqual(20);
    expect(LAUNCH.limits.dailyAiRequests).toBeLessThanOrEqual(200);
    expect(LAUNCH.limits.dailySlipBuilds).toBeGreaterThanOrEqual(10);
    expect(LAUNCH.limits.dailyUploads).toBeGreaterThanOrEqual(5);
    expect(LAUNCH.limits.dailyAnalyses).toBeGreaterThanOrEqual(5);
  });
});
