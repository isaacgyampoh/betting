import type { BookmakerEventInfo, RawMarket } from "@/lib/bookmakers/types";
import type { Market } from "@/lib/markets/types";
import { buildTargetSlip, chanceInWords, confidenceOf, type Candidate } from "@/lib/slips/target-odds";

// Turns a bookmaker's real fixture list into a slip that reaches a target total odds, using a
// spread of markets rather than five variations of the same bet.
//
// Everything here is derived from numbers the bookmaker published: the price, and its own
// margin-free probability for that outcome. Nothing is modelled, estimated or invented. A market we
// cannot label in plain words is dropped rather than shown with a raw id.

/** Market groups we are willing to build with, and how many of each a slip may contain. */
export const MARKET_GROUPS = {
  result: { label: "Match result", maxPerSlip: 2 },
  double_chance: { label: "Double chance", maxPerSlip: 2 },
  goals: { label: "Goals over/under", maxPerSlip: 2 },
  btts: { label: "Both teams to score", maxPerSlip: 2 },
  team_goals: { label: "Team goals", maxPerSlip: 2 },
  first_half: { label: "First half", maxPerSlip: 2 },
  corners: { label: "Corners", maxPerSlip: 2 },
  cards: { label: "Cards", maxPerSlip: 2 },
  fouls: { label: "Fouls", maxPerSlip: 1 },
} as const;

export type MarketGroup = keyof typeof MARKET_GROUPS;

/**
 * The groups we hold comparable history for, so a pick in one of them can be backed by counts of
 * real results rather than by the price alone. Corners, cards, fouls, team totals and half markets
 * are real and bookable, but nothing in our stats speaks to them — so they are a fallback, used
 * when the evidenced groups cannot reach the target on their own.
 */
export const EVIDENCE_GROUPS: MarketGroup[] = ["result", "double_chance", "goals", "btts"];

export const hasEvidenceSupport = (group: MarketGroup) => EVIDENCE_GROUPS.includes(group);

const GROUP_OF: Record<string, MarketGroup> = {
  "1": "result",
  "10": "double_chance",
  "18": "goals",
  "29": "btts",
  "19": "team_goals",
  "20": "team_goals",
  "68": "first_half",
  "75": "first_half",
  "166": "corners",
  "139": "cards",
  "900342": "fouls",
};

const line = (specifier: string): number | null => {
  const m = specifier.match(/^total=(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : null;
};

/** "Over 1 goal", not "Over 1 goals". Betradar lines are often whole numbers, so this does come up. */
const plural = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;

const overUnder = (specifier: string, outcomeId: string, noun: string): string | null => {
  const n = line(specifier);
  if (n === null) return null;
  const amount = plural(n, noun);
  return outcomeId === "12" ? `Over ${amount}` : outcomeId === "13" ? `Under ${amount}` : null;
};

/**
 * A plain-English description of one offer, or null when we would have to guess.
 * Team names come from the fixture, so a pick always names the side rather than "Home".
 */
export function describeOffer(event: Pick<BookmakerEventInfo, "home" | "away">, raw: RawMarket): string | null {
  const { marketId, outcomeId, specifier } = raw;
  const { home, away } = event;
  switch (marketId) {
    case "1":
      return outcomeId === "1" ? `${home} to win` : outcomeId === "2" ? "Draw" : outcomeId === "3" ? `${away} to win` : null;
    case "10":
      return outcomeId === "9"
        ? `${home} to win or draw`
        : outcomeId === "10"
          ? `${home} or ${away} to win (no draw)`
          : outcomeId === "11"
            ? `${away} to win or draw`
            : null;
    case "18":
      return overUnder(specifier, outcomeId, "goal");
    case "29":
      return outcomeId === "74" ? "Both teams to score" : outcomeId === "76" ? "At least one team not to score" : null;
    case "19": {
      const n = line(specifier);
      if (n === null) return null;
      return outcomeId === "12" ? `${home} over ${plural(n, "goal")}` : outcomeId === "13" ? `${home} under ${plural(n, "goal")}` : null;
    }
    case "20": {
      const n = line(specifier);
      if (n === null) return null;
      return outcomeId === "12" ? `${away} over ${plural(n, "goal")}` : outcomeId === "13" ? `${away} under ${plural(n, "goal")}` : null;
    }
    case "68": {
      const label = overUnder(specifier, outcomeId, "goal");
      return label && `${label} in the first half`;
    }
    case "75":
      return outcomeId === "74" ? "Both teams to score in the first half" : outcomeId === "76" ? "Not both teams to score in the first half" : null;
    case "166":
      return overUnder(specifier, outcomeId, "corner");
    case "139":
      return overUnder(specifier, outcomeId, "card");
    case "900342":
      return overUnder(specifier, outcomeId, "foul");
    default:
      return null;
  }
}

export type FixtureOfferInput = {
  raw: RawMarket;
  market: Market | null;
  odds: number;
  probability: number | null;
};

export type FixtureInput = { event: BookmakerEventInfo; offers: FixtureOfferInput[] };

export type PickCandidate = {
  event: BookmakerEventInfo;
  kind: FixtureKind;
  raw: RawMarket;
  market: Market | null;
  odds: number;
  /** The bookmaker's own probability for this outcome. */
  probability: number;
  group: MarketGroup;
  /** Plain-English description, e.g. "Over 2.5 goals". */
  label: string;
  /** The market's name as the bookmaker shows it, e.g. "Corners - Over/Under". */
  marketLabel: string;
  /** True when this is the likeliest outcome of its own market. */
  favourite: boolean;
};

/**
 * What kind of fixture this is, from the competition and team names the bookmaker gives us.
 *
 * Friendlies are excluded by default: line-ups are experimental, substitutions are unlimited in
 * many of them, and recent form says much less about them than about a league game. Women's and
 * youth football are *not* excluded by default — the data is fine — but a user can ask for them to
 * be left out, which is a common request.
 */
export type FixtureKind = "friendly" | "womens" | "youth" | "standard";

const FRIENDLY = /\bfriendl(y|ies)\b|\bclub friendl/i;
const WOMENS = /\bwomen'?s?\b|\bfeminin|\bfrauen\b|\bdamallsvenskan\b/i;
/** An explicit age bracket is unambiguous wherever it appears, including in a team name. */
const AGE_BRACKET = /\bU-?(1[5-9]|2[0-3])\b/i;
/**
 * These words are only reliable in a *competition* name. Real senior clubs are called things like
 * Atletico Junior and Academy, so matching them on a team name would wrongly drop real fixtures.
 */
const YOUTH_COMPETITION = /\byouth\b|\bjunior(es)?\b|\bprimavera\b|\bacademy\b|\breserves?\b/i;

/** A trailing " W" on both team names is how most feeds mark a women's fixture. */
const womensTeams = (home: string, away: string) => /\s(W|\(W\))$/.test(home.trim()) && /\s(W|\(W\))$/.test(away.trim());

export function classifyFixture(event: Pick<BookmakerEventInfo, "home" | "away" | "competition">): FixtureKind {
  const competition = event.competition ?? "";
  const text = `${competition} ${event.home} ${event.away}`;
  if (AGE_BRACKET.test(text) || YOUTH_COMPETITION.test(competition)) return "youth";
  if (WOMENS.test(competition) || womensTeams(event.home, event.away)) return "womens";
  if (FRIENDLY.test(competition)) return "friendly";
  return "standard";
}

export type CandidateFilter = {
  /** Kinds to leave out. Friendlies are dropped unless explicitly asked for. */
  exclude?: FixtureKind[];
  /** Reject anything the bookmaker rates below this. Default 0.45: no coin-flips or worse. */
  minProbability?: number;
  /** Reject near-certainties: they add nothing to the total odds. Default 0.93. */
  maxProbability?: number;
  /** Only fixtures kicking off at least this far ahead, so a slip is still bookable. */
  minMinutesToKickoff?: number;
};

/**
 * Every offer we could honestly build with, newest prices first. Drops anything without a published
 * probability: we will not fabricate one, and a pick we cannot rate has no place in a built slip.
 */
export function toCandidates(fixtures: FixtureInput[], filter: CandidateFilter = {}): PickCandidate[] {
  const { minProbability = 0.45, maxProbability = 0.93, minMinutesToKickoff = 15, exclude = ["friendly"] } = filter;
  const cutoff = Date.now() + minMinutesToKickoff * 60_000;
  const skip = new Set(exclude);
  const out: PickCandidate[] = [];

  for (const { event, offers } of fixtures) {
    if (event.status !== "NOT_STARTED" || event.kickoffAt.getTime() < cutoff) continue;
    if (skip.has(classifyFixture(event))) continue;

    // The likeliest outcome within each market, so a pick can say whether it is the favourite.
    const bestInMarket = new Map<string, number>();
    for (const o of offers) {
      if (o.probability === null) continue;
      const key = `${o.raw.marketId}|${o.raw.specifier}`;
      bestInMarket.set(key, Math.max(bestInMarket.get(key) ?? 0, o.probability));
    }

    for (const o of offers) {
      const group = GROUP_OF[o.raw.marketId];
      if (!group || o.probability === null) continue;
      if (o.probability < minProbability || o.probability > maxProbability) continue;
      if (!(o.odds > 1.02)) continue;
      const label = describeOffer(event, o.raw);
      if (!label) continue;
      out.push({
        event,
        kind: classifyFixture(event),
        raw: o.raw,
        market: o.market,
        odds: o.odds,
        probability: o.probability,
        group,
        label,
        marketLabel: o.raw.marketName ?? MARKET_GROUPS[group].label,
        favourite: o.probability >= (bestInMarket.get(`${o.raw.marketId}|${o.raw.specifier}`) ?? 0) - 1e-9,
      });
    }
  }
  return out;
}

/** One honest line per pick, built only from what the bookmaker published. */
export function reasonFor(c: PickCandidate, bookmakerName: string): string {
  const pct = Math.round(c.probability * 100);
  const where = c.event.competition ? ` in the ${c.event.competition}` : "";
  switch (c.group) {
    case "result":
    case "double_chance":
      // Only claim "likeliest" when it really is the top outcome of its own market.
      return c.favourite
        ? `${bookmakerName} make this the likeliest result${where}, at about ${pct}%.`
        : `${bookmakerName} rate this at about ${pct}%${where}.`;
    case "goals":
    case "first_half":
      return `${bookmakerName}'s own numbers put this goals line at about ${pct}%.`;
    case "btts": {
      // outcome 74 is "both teams score"; 76 is the opposite. Describing the wrong one would
      // state the inverse of the pick, so key off the outcome rather than the market.
      const both = c.raw.outcomeId === "74";
      const half = c.raw.marketId === "75" ? " in the first half" : "";
      return both
        ? `${bookmakerName} price both teams scoring${half} at about ${pct}%.`
        : `${bookmakerName} give about ${pct}% that at least one side fails to score${half}.`;
    }
    case "team_goals":
      return `${bookmakerName} give this team's goal line about ${pct}%.`;
    case "corners":
      return `${bookmakerName} rate this corner line at about ${pct}%.`;
    case "cards":
      return `${bookmakerName} rate this card line at about ${pct}%${where}.`;
    case "fouls":
      return `${bookmakerName} rate this foul line at about ${pct}%.`;
  }
}

export type BuiltPick = PickCandidate & { position: number; reason: string };

export type FixtureSlip = {
  picks: BuiltPick[];
  totalOdds: number;
  /** Estimated chance every pick lands. An estimate, never a promise. */
  probability: number;
  chance: string;
  confidence: "low" | "medium" | "high";
  reachedTarget: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How many legs a target deserves. A punter asking for 2 odds wants a two- or three-game slip, not
 * six near-certainties multiplied together — even though the latter can score a higher combined
 * probability, which is what the search optimises for if left unbounded.
 */
export function legsForTarget(target: number): number {
  return Math.max(2, Math.min(6, Math.ceil(Math.log(target) / Math.log(1.45))));
}

/**
 * Probability bands used to keep the shortlist spread across prices. Ranking purely by probability
 * fills the pool with 1.05 shots, and no combination of those reaches a target like 5.
 */
const BANDS: [number, number][] = [
  [0.85, 1.0], // ~1.05-1.20
  [0.72, 0.85], // ~1.20-1.40
  [0.6, 0.72], // ~1.40-1.70
  [0.45, 0.6], // ~1.70-2.25
];

/**
 * A varied shortlist: one pick per fixture, a capped number per market group, and spread across
 * price bands so both small and large targets are reachable. Exported so recent-results research can
 * run over exactly this set before a slip is chosen from it.
 */
export function shortlistCandidates(candidates: PickCandidate[], shortlist = 18): PickCandidate[] {
  const byBand = BANDS.map(([lo, hi]) =>
    candidates.filter((c) => c.probability >= lo && c.probability < hi).sort((a, b) => b.probability - a.probability),
  );
  const usedEvents = new Set<string>();
  const perGroup = new Map<MarketGroup, number>();
  const pool: PickCandidate[] = [];
  const cursor = new Array(byBand.length).fill(0);

  let exhausted = false;
  while (pool.length < shortlist && !exhausted) {
    exhausted = true;
    for (let b = 0; b < byBand.length && pool.length < shortlist; b++) {
      const band = byBand[b];
      while (cursor[b] < band.length) {
        const c = band[cursor[b]++];
        if (usedEvents.has(c.event.externalId)) continue;
        const used = perGroup.get(c.group) ?? 0;
        if (used >= MARKET_GROUPS[c.group].maxPerSlip) continue;
        usedEvents.add(c.event.externalId);
        perGroup.set(c.group, used + 1);
        pool.push(c);
        exhausted = false;
        break;
      }
    }
  }
  return pool;
}

/**
 * Chooses a varied shortlist and then the combination that reaches `target` with the best estimated
 * chance. Variety is enforced before the search, not after, so the result is the best *varied* slip
 * rather than the best slip with variety bolted on.
 *
 * Pass `preShortlisted` when the caller has already narrowed and filtered the set (for example after
 * dropping picks that recent results argue against), so it is not narrowed twice.
 */
export function buildFromFixtures(
  candidates: PickCandidate[],
  target: number,
  opts: { maxPicks?: number; bookmakerName?: string; shortlist?: number; preShortlisted?: boolean } = {},
): FixtureSlip | null {
  const { maxPicks = legsForTarget(target), bookmakerName = "The bookmaker", shortlist = 18, preShortlisted = false } = opts;
  const pool = preShortlisted ? candidates.slice(0, shortlist) : shortlistCandidates(candidates, shortlist);
  if (!pool.length) return null;

  const scored: Candidate[] = pool.map((c, i) => ({ position: i, odds: c.odds, bookmakerProbability: c.probability }));
  const selection = buildTargetSlip(scored, target, { maxPicks });
  if (!selection) return null;

  const picks: BuiltPick[] = selection.positions.map((position, i) => {
    const c = pool[position];
    return { ...c, position: i + 1, reason: reasonFor(c, bookmakerName) };
  });

  return {
    picks,
    totalOdds: round2(picks.reduce((p, c) => p * c.odds, 1)),
    probability: selection.probability,
    chance: chanceInWords(selection.probability),
    confidence: confidenceOf(selection.probability),
    reachedTarget: selection.reachedTarget,
  };
}
