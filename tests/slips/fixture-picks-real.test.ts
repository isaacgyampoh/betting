import { describe, expect, it } from "vitest";
import { listUpcomingWithOffers } from "@/lib/bookmakers/live/sportybet";
import { buildFromFixtures, toCandidates } from "@/lib/slips/fixture-picks";
import { createAdapter } from "@/lib/bookmakers/registry";

const adapter = createAdapter("sportybet", "live");

// Builds real slips from real SportyBet prices. Skipped unless VERIFY_LIVE=1 (needs the network):
//   VERIFY_LIVE=1 pnpm vitest run tests/slips/fixture-picks-real.test.ts

const live = process.env.VERIFY_LIVE === "1";

describe.skipIf(!live)("building slips from real fixtures", () => {
  it("builds a 2 odds and a 5 odds slip with varied markets", async () => {
    const fixtures = await listUpcomingWithOffers({ hours: 48, pages: 3 });
    expect(fixtures.length).toBeGreaterThan(5);

    const candidates = toCandidates(fixtures);
    expect(candidates.length).toBeGreaterThan(10);
    // Every candidate must carry a real published probability and a human label.
    for (const c of candidates) {
      expect(c.probability).toBeGreaterThan(0);
      expect(c.probability).toBeLessThanOrEqual(1);
      expect(c.label).not.toMatch(/^\d|Home|Away$/);
    }
    const groups = new Set(candidates.map((c) => c.group));
    console.log(`\n  ${fixtures.length} fixtures → ${candidates.length} candidates across: ${[...groups].join(", ")}`);

    for (const target of [2, 5]) {
      const slip = buildFromFixtures(candidates, target, { bookmakerName: "SportyBet" });
      expect(slip, `target ${target}`).not.toBeNull();
      expect(slip!.totalOdds).toBeGreaterThanOrEqual(target);
      expect(slip!.picks.length).toBeGreaterThan(0);
      // One pick per fixture, and a spread of markets rather than the same bet repeated.
      expect(new Set(slip!.picks.map((p) => p.event.externalId)).size).toBe(slip!.picks.length);
      if (slip!.picks.length >= 3) expect(new Set(slip!.picks.map((p) => p.group)).size).toBeGreaterThan(1);

      console.log(`\n  ${target} odds → ${slip!.totalOdds} (${slip!.chance}, ${slip!.confidence} confidence)`);
      for (const p of slip!.picks) {
        console.log(`    ${p.position}. ${p.event.home} v ${p.event.away} — ${p.label} @ ${p.odds} [${p.group}]`);
        console.log(`       ${p.reason}`);
        expect(p.reason).toContain("SportyBet");
      }

      // The whole point: these picks must be bookable at SportyBet, including the markets we don't
      // model internally (corners, cards, fouls), which is why they are booked by raw market id.
      const created = await adapter.createCode(
        slip!.picks.map((p) => ({ eventExternalId: p.event.externalId, raw: p.raw })),
      );
      expect(created.code).toMatch(/^[A-Z0-9]{5,10}$/);
      console.log(`     → booked on SportyBet as ${created.code}`);

      const back = await adapter.loadCode(created.code);
      expect(back.selections).toHaveLength(slip!.picks.length);
      expect(back.selections.every((s) => (s.odds ?? 0) > 1)).toBe(true);
    }
  }, 180_000);
});
