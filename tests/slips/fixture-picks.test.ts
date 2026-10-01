import { describe, expect, it } from "vitest";
import {
  buildFromFixtures,
  classifyFixture,
  describeOffer,
  legsForTarget,
  reasonFor,
  toCandidates,
  type FixtureInput,
  type PickCandidate,
} from "@/lib/slips/fixture-picks";
import type { BookmakerEventInfo, RawMarket } from "@/lib/bookmakers/types";

const teams = { home: "Arsenal", away: "Chelsea" };

const event = (i: number, overrides: Partial<BookmakerEventInfo> = {}): BookmakerEventInfo => ({
  externalId: `sr:match:${i}`,
  home: `Home ${i}`,
  away: `Away ${i}`,
  kickoffAt: new Date(Date.now() + 6 * 3_600_000),
  competition: "Premier League",
  country: "England",
  status: "NOT_STARTED",
  ...overrides,
});

const raw = (marketId: string, outcomeId: string, specifier = ""): RawMarket => ({ marketId, outcomeId, specifier });

describe("describeOffer", () => {
  it.each<[string, RawMarket, string]>([
    ["home win", raw("1", "1"), "Arsenal to win"],
    ["draw", raw("1", "2"), "Draw"],
    ["away win", raw("1", "3"), "Chelsea to win"],
    ["double chance", raw("10", "9"), "Arsenal to win or draw"],
    ["goals over", raw("18", "12", "total=2.5"), "Over 2.5 goals"],
    ["goals under", raw("18", "13", "total=3"), "Under 3 goals"],
    ["btts yes", raw("29", "74"), "Both teams to score"],
    ["btts no", raw("29", "76"), "At least one team not to score"],
    ["team total", raw("19", "12", "total=1.5"), "Arsenal over 1.5 goals"],
    ["away team total", raw("20", "13", "total=0.5"), "Chelsea under 0.5 goals"],
    ["first half goals", raw("68", "12", "total=0.5"), "Over 0.5 goals in the first half"],
    ["first half btts", raw("75", "74"), "Both teams to score in the first half"],
    ["corners", raw("166", "12", "total=9.5"), "Over 9.5 corners"],
    ["cards", raw("139", "13", "total=3.5"), "Under 3.5 cards"],
    ["fouls", raw("900342", "12", "total=21.5"), "Over 21.5 fouls"],
  ])("describes %s", (_name, r, expected) => {
    expect(describeOffer(teams, r)).toBe(expected);
  });

  it("uses the singular for a line of exactly one", () => {
    expect(describeOffer(teams, raw("18", "12", "total=1"))).toBe("Over 1 goal");
    expect(describeOffer(teams, raw("166", "13", "total=1"))).toBe("Under 1 corner");
  });

  it("returns null rather than guessing at a market it cannot label", () => {
    expect(describeOffer(teams, raw("45", "274"))).toBeNull(); // correct score
    expect(describeOffer(teams, raw("18", "12", ""))).toBeNull(); // over/under with no line
    expect(describeOffer(teams, raw("1", "99"))).toBeNull(); // unknown outcome
  });
});

describe("toCandidates", () => {
  const fixture = (offers: FixtureInput["offers"], ev = event(1)): FixtureInput => ({ event: ev, offers });
  const offer = (r: RawMarket, odds: number, probability: number | null) => ({ raw: r, market: null, odds, probability });

  it("keeps offers that have a real published probability and a label", () => {
    const got = toCandidates([fixture([offer(raw("18", "12", "total=2.5"), 1.5, 0.7)])]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ group: "goals", label: "Over 2.5 goals", odds: 1.5, probability: 0.7 });
  });

  it("drops an offer with no published probability rather than inventing one", () => {
    expect(toCandidates([fixture([offer(raw("18", "12", "total=2.5"), 1.5, null)])])).toEqual([]);
  });

  it("drops markets it has no plain-English label for", () => {
    expect(toCandidates([fixture([offer(raw("45", "274"), 8, 0.6)])])).toEqual([]);
  });

  it("applies the probability band", () => {
    const offers = [offer(raw("18", "12", "total=2.5"), 1.02, 0.98), offer(raw("18", "13", "total=2.5"), 6, 0.15)];
    expect(toCandidates([fixture(offers)])).toEqual([]);
  });

  it("skips games that have started or kick off too soon", () => {
    const o = [offer(raw("29", "74"), 1.6, 0.6)];
    expect(toCandidates([fixture(o, event(1, { status: "LIVE" }))])).toEqual([]);
    expect(toCandidates([fixture(o, event(1, { kickoffAt: new Date(Date.now() + 60_000) }))])).toEqual([]);
  });

  it("marks the likeliest outcome of a market as the favourite", () => {
    const got = toCandidates([
      fixture([offer(raw("1", "1"), 1.4, 0.72), offer(raw("1", "3"), 2.1, 0.48)]),
    ]);
    expect(got.find((c) => c.raw.outcomeId === "1")!.favourite).toBe(true);
    expect(got.find((c) => c.raw.outcomeId === "3")!.favourite).toBe(false);
  });
});

describe("reasonFor", () => {
  const base = (over: Partial<PickCandidate>): PickCandidate => ({
    event: event(1),
    kind: "standard",
    raw: raw("29", "74"),
    market: null,
    odds: 1.7,
    probability: 0.59,
    group: "btts",
    label: "Both teams to score",
    marketLabel: "GG/NG",
    favourite: false,
    ...over,
  });

  it("describes the pick that was made, not its opposite", () => {
    expect(reasonFor(base({}), "SportyBet")).toBe("SportyBet price both teams scoring at about 59%.");
    expect(reasonFor(base({ raw: raw("29", "76"), label: "At least one team not to score" }), "SportyBet")).toBe(
      "SportyBet give about 59% that at least one side fails to score.",
    );
  });

  it("says 'in the first half' only for the first-half market", () => {
    expect(reasonFor(base({ raw: raw("75", "74"), group: "btts" }), "SportyBet")).toContain("in the first half");
  });

  it("claims 'likeliest' only when the pick really is the market favourite", () => {
    const fav = base({ group: "result", raw: raw("1", "1"), favourite: true, probability: 0.72 });
    expect(reasonFor(fav, "SportyBet")).toContain("likeliest result");
    expect(reasonFor({ ...fav, favourite: false }, "SportyBet")).not.toContain("likeliest");
  });
});

describe("buildFromFixtures", () => {
  // One fixture per candidate, spread across groups and prices.
  const candidates = (specs: [string, string, string, number, number][]): PickCandidate[] =>
    toCandidates(
      specs.map(([marketId, outcomeId, specifier, odds, probability], i) => ({
        event: event(i),
        offers: [{ raw: raw(marketId, outcomeId, specifier), market: null, odds, probability }],
      })),
    );

  const pool = candidates([
    ["1", "1", "", 1.1, 0.9],
    ["10", "9", "", 1.2, 0.82],
    ["18", "12", "total=1.5", 1.35, 0.72],
    ["29", "74", "", 1.6, 0.6],
    ["166", "12", "total=8.5", 1.5, 0.64],
    ["139", "12", "total=2.5", 1.75, 0.55],
    ["900342", "12", "total=20.5", 1.9, 0.5],
    ["68", "12", "total=0.5", 1.25, 0.78],
  ]);

  it("reaches the target", () => {
    for (const target of [2, 3, 5, 10]) {
      const slip = buildFromFixtures(pool, target);
      expect(slip, `target ${target}`).not.toBeNull();
      expect(slip!.totalOdds).toBeGreaterThanOrEqual(target);
      expect(slip!.reachedTarget).toBe(true);
    }
  });

  it("never uses the same game twice", () => {
    const slip = buildFromFixtures(pool, 5)!;
    expect(new Set(slip.picks.map((p) => p.event.externalId)).size).toBe(slip.picks.length);
  });

  it("keeps a small target to few legs", () => {
    expect(buildFromFixtures(pool, 2)!.picks.length).toBeLessThanOrEqual(legsForTarget(2));
    expect(legsForTarget(2)).toBe(2);
    expect(legsForTarget(5)).toBe(5);
  });

  it("spreads across market groups rather than repeating one bet", () => {
    const sameMarket = candidates(
      Array.from({ length: 8 }, (_, i) => ["18", "12", `total=${1.5 + i}`, 1.5, 0.64] as [string, string, string, number, number]),
    );
    // Only two goals picks are allowed per slip, so an unreachable target must not be faked.
    const slip = buildFromFixtures(sameMarket, 5);
    expect(slip!.picks.filter((p) => p.group === "goals").length).toBeLessThanOrEqual(2);
    expect(slip!.reachedTarget).toBe(false);
  });

  it("says so when the target is out of reach instead of inventing picks", () => {
    const slip = buildFromFixtures(pool, 10_000)!;
    expect(slip.reachedTarget).toBe(false);
    expect(slip.totalOdds).toBeLessThan(10_000);
  });

  it("returns null when there is nothing to build with", () => {
    expect(buildFromFixtures([], 5)).toBeNull();
  });

  it("estimates a chance and never promises one", () => {
    const slip = buildFromFixtures(pool, 5)!;
    expect(slip.probability).toBeGreaterThan(0);
    expect(slip.probability).toBeLessThan(1);
    expect(slip.chance).toMatch(/chance|likely/);
    expect(["low", "medium", "high"]).toContain(slip.confidence);
  });
});

describe("classifyFixture", () => {
  const ev = (competition: string | null, home = "A", away = "B") => ({ competition, home, away });

  it.each([
    ["Int. Friendly Games", "friendly"],
    ["Club Friendlies", "friendly"],
    ["International Friendly", "friendly"],
  ])("treats %s as a friendly", (comp, kind) => {
    expect(classifyFixture(ev(comp))).toBe(kind);
  });

  it("spots women's football from the competition or the team names", () => {
    expect(classifyFixture(ev("UEFA Women's Champions League"))).toBe("womens");
    expect(classifyFixture(ev("Damallsvenskan"))).toBe("womens");
    expect(classifyFixture(ev("Some Cup", "Hacken Gothenburg W", "Juventus Turin W"))).toBe("womens");
    // A single trailing W isn't enough: plenty of men's clubs end in a W-word.
    expect(classifyFixture(ev("Premier League", "Wolves W", "Arsenal"))).toBe("standard");
  });

  it("spots youth football", () => {
    expect(classifyFixture(ev("Primera Division U20"))).toBe("youth");
    expect(classifyFixture(ev("Some League", "CD Aguila", "Inter Santa Tecla U20"))).toBe("youth");
    expect(classifyFixture(ev("Campeonato Juniores"))).toBe("youth");
    expect(classifyFixture(ev("Premier League 2 Youth"))).toBe("youth");
    expect(classifyFixture(ev("Liga Primavera"))).toBe("youth");
  });

  it("leaves ordinary league football alone", () => {
    expect(classifyFixture(ev("UEFA Nations League", "Germany", "Serbia"))).toBe("standard");
    expect(classifyFixture(ev("LALIGA HYPERMOTION"))).toBe("standard");
    expect(classifyFixture(ev(null, "Kotoko", "Hearts of Oak"))).toBe("standard");
  });

  it("doesn't mistake a senior club whose name contains a youth word", () => {
    // Atletico Junior is a senior Colombian club; words like Junior and Academy only count in a
    // competition name. An explicit age bracket is unambiguous anywhere.
    expect(classifyFixture(ev("Serie A", "Atletico Junior", "Santa Fe"))).toBe("standard");
    expect(classifyFixture(ev("Primera A", "Academy FC", "Millonarios"))).toBe("standard");
    expect(classifyFixture(ev("Primera A", "Millonarios U20", "Santa Fe"))).toBe("youth");
  });
});

describe("excluding fixture kinds", () => {
  const offers = [{ raw: raw("18", "12", "total=1.5"), market: null, odds: 1.5, probability: 0.7 }];
  const fixture = (competition: string, home = "A", away = "B") => ({
    event: { ...event(1), competition, home, away },
    offers,
  });

  it("leaves friendlies out by default, since form says little about them", () => {
    expect(toCandidates([fixture("Int. Friendly Games")])).toEqual([]);
    expect(toCandidates([fixture("Premier League")])).toHaveLength(1);
  });

  it("includes women's and youth football unless asked not to", () => {
    expect(toCandidates([fixture("UEFA Women's Champions League")])).toHaveLength(1);
    expect(toCandidates([fixture("Primera Division U20")])).toHaveLength(1);
    expect(toCandidates([fixture("Primera Division U20")], { exclude: ["youth"] })).toEqual([]);
    expect(toCandidates([fixture("UEFA Women's Champions League")], { exclude: ["womens"] })).toEqual([]);
  });

  it("can be asked to include friendlies", () => {
    expect(toCandidates([fixture("Int. Friendly Games")], { exclude: [] })).toHaveLength(1);
  });
});
