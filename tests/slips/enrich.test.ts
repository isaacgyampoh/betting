import { describe, expect, it } from "vitest";
import { pickKey, rankByEvidence, reasonWithEvidence, withoutContradicted, type EnrichedPick } from "@/lib/slips/enrich";
import type { PickCandidate } from "@/lib/slips/fixture-picks";

const pick = (over: Partial<EnrichedPick> = {}): EnrichedPick => ({
  event: {
    externalId: "sr:match:1",
    home: "A",
    away: "B",
    kickoffAt: new Date(),
    competition: "L",
    country: "C",
    status: "NOT_STARTED",
  },
  kind: "standard",
  raw: { marketId: "18", outcomeId: "12", specifier: "total=1.5" },
  market: { type: "OVER_UNDER", period: "FT", outcome: "OVER", line: 1.5 },
  odds: 1.5,
  probability: 0.7,
  group: "goals",
  label: "Over 1.5 goals",
  marketLabel: "Over/Under",
  favourite: true,
  evidence: null,
  gap: "none",
  ...over,
}) as EnrichedPick;

const evidence = (support: number, sample: number) => ({ text: "counts.", support, sample });

describe("withoutContradicted", () => {
  it("drops a pick recent results argue against", () => {
    const { kept, dropped } = withoutContradicted([pick({ evidence: evidence(0.3, 10) })]);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("keeps a pick recent results support", () => {
    expect(withoutContradicted([pick({ evidence: evidence(0.8, 10) })]).kept).toHaveLength(1);
  });

  it("won't let a thin sample veto anything", () => {
    // Two or three games say nothing; only a real sample may overrule the price.
    expect(withoutContradicted([pick({ evidence: evidence(0.1, 4) })]).kept).toHaveLength(1);
  });

  it("keeps a pick with no evidence: absence of history is not evidence against", () => {
    expect(withoutContradicted([pick({ evidence: null, gap: "market-not-covered" })]).kept).toHaveLength(1);
  });
});

describe("pickKey", () => {
  it("separates picks that differ only by line, so a veto can't be dodged", () => {
    const a = pick();
    const b = pick({ raw: { marketId: "18", outcomeId: "12", specifier: "total=2.5" } });
    expect(pickKey(a)).not.toBe(pickKey(b));
  });

  it("matches the same pick across rebuilds", () => {
    expect(pickKey(pick())).toBe(pickKey(pick({ odds: 9.9 } as Partial<PickCandidate>)));
  });
});

describe("reasonWithEvidence", () => {
  it("leads with the counts when there are any", () => {
    expect(reasonWithEvidence(pick({ evidence: evidence(0.8, 10) }), "Priced at 1.5.")).toBe("counts. Priced at 1.5.");
  });

  it("says the stats were unavailable, not that nothing was found", () => {
    const r = reasonWithEvidence(pick({ gap: "stats-plan" }), "Priced at 1.5.");
    expect(r).toContain("couldn't pull recent form");
  });

  it("says plainly when a market has no comparable history", () => {
    expect(reasonWithEvidence(pick({ gap: "market-not-covered" }), "Priced at 1.5.")).toContain("rests on the price alone");
  });
});

describe("rankByEvidence", () => {
  it("puts a backed pick above an equally priced one with nothing behind it", () => {
    const backed = pick({ evidence: evidence(0.9, 10), label: "backed" });
    const bare = pick({ label: "bare" });
    expect(rankByEvidence([bare, backed])[0].label).toBe("backed");
  });
});
