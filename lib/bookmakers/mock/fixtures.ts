// Shared mock fixtures. Each bookmaker's mock spells the teams its own way so cross-bookmaker
// matching (Milestone 3) has realistic work to do. Spellings are illustrative, not captured.

export type MockFixture = {
  key: string;
  competition: string;
  country: string;
  /** Minutes from "now"; negative = already started. */
  kickoffOffsetMin: number;
  /** Team spellings per bookmaker; bookmakers without an entry use the SportyBet spelling. */
  names: Partial<Record<import("@/lib/bookmakers/types").BookmakerSlug, [string, string]>> & { sportybet: [string, string] };
  /** Restrict the fixture to these bookmakers (exercises "game not found" on conversion). */
  onlyOn?: import("@/lib/bookmakers/types").BookmakerSlug[];
  /** Fair 1X2 odds; other markets are derived from these. */
  odds1x2: [number, number, number];
  /** Fair probability of over 2.5 goals. */
  pOver25: number;
};

/** Rounds "now" to the next quarter hour, then offsets, so mock kickoffs look real. */
export function mockKickoff(offsetMin: number, now = new Date()): Date {
  const base = new Date(now);
  base.setUTCSeconds(0, 0);
  base.setUTCMinutes(Math.ceil(base.getUTCMinutes() / 15) * 15);
  return new Date(base.getTime() + offsetMin * 60_000);
}

const DAY = 24 * 60;

export const FIXTURES: MockFixture[] = [
  {
    key: "epl-mun-tot",
    competition: "Premier League",
    country: "England",
    kickoffOffsetMin: DAY + 180,
    names: {
      sportybet: ["Manchester United", "Tottenham"],
      betway: ["Man Utd", "Tottenham Hotspur"],
      "1xbet": ["Manchester United", "Tottenham Hotspur"],
      msport: ["Man United", "Tottenham"],
    },
    odds1x2: [2.1, 3.6, 3.4],
    pOver25: 0.58,
  },
  {
    key: "epl-ars-new",
    competition: "Premier League",
    country: "England",
    kickoffOffsetMin: DAY + 300,
    names: { sportybet: ["Arsenal", "Newcastle"], betway: ["Arsenal", "Newcastle United"] },
    odds1x2: [1.62, 4.1, 5.4],
    pOver25: 0.55,
  },
  {
    key: "epl-wol-nfo",
    competition: "Premier League",
    country: "England",
    kickoffOffsetMin: DAY + 60,
    names: { sportybet: ["Wolverhampton", "Nottingham Forest"], betway: ["Wolves", "Nottm Forest"] },
    odds1x2: [2.6, 3.25, 2.8],
    pOver25: 0.47,
  },
  {
    key: "epl-bha-mci",
    competition: "Premier League",
    country: "England",
    kickoffOffsetMin: 2 * DAY + 120,
    names: { sportybet: ["Brighton", "Manchester City"], betway: ["Brighton & Hove Albion", "Man City"] },
    odds1x2: [4.3, 4.0, 1.75],
    pOver25: 0.63,
  },
  {
    key: "lal-atm-bet",
    competition: "LaLiga",
    country: "Spain",
    kickoffOffsetMin: DAY + 420,
    names: { sportybet: ["Atletico Madrid", "Real Betis"], betway: ["Atl. Madrid", "Betis"] },
    odds1x2: [1.55, 4.0, 6.2],
    pOver25: 0.49,
  },
  {
    key: "lal-bar-ath",
    competition: "LaLiga",
    country: "Spain",
    kickoffOffsetMin: 2 * DAY + 360,
    names: { sportybet: ["FC Barcelona", "Athletic Bilbao"], betway: ["Barcelona", "Athletic Club"] },
    odds1x2: [1.45, 4.8, 6.5],
    pOver25: 0.62,
  },
  {
    key: "sea-int-mil",
    competition: "Serie A",
    country: "Italy",
    kickoffOffsetMin: DAY + 405,
    names: { sportybet: ["Inter Milano", "AC Milan"], betway: ["Inter", "Milan"], "1xbet": ["Inter Milan", "AC Milan"], betpawa: ["Internazionale", "AC Milan"] },
    odds1x2: [1.95, 3.6, 3.9],
    pOver25: 0.56,
  },
  {
    key: "sea-nap-juv",
    competition: "Serie A",
    country: "Italy",
    kickoffOffsetMin: 2 * DAY + 405,
    names: { sportybet: ["SSC Napoli", "Juventus"], betway: ["Napoli", "Juventus"] },
    odds1x2: [2.3, 3.2, 3.2],
    pOver25: 0.45,
  },
  {
    key: "gpl-kot-hoo",
    competition: "Premier League",
    country: "Ghana",
    kickoffOffsetMin: DAY + 60,
    names: { sportybet: ["Asante Kotoko", "Hearts of Oak"], betway: ["Kotoko", "Accra Hearts of Oak"], betpawa: ["Asante Kotoko SC", "Accra Hearts of Oak"], msport: ["Kotoko", "Hearts of Oak"] },
    odds1x2: [2.05, 2.9, 4.1],
    pOver25: 0.38,
  },
  {
    key: "gpl-med-dre",
    competition: "Premier League",
    country: "Ghana",
    kickoffOffsetMin: DAY - 60,
    names: { sportybet: ["Medeama SC", "Dreams FC"], betway: ["Medeama", "Dreams"] },
    odds1x2: [1.9, 3.0, 4.6],
    pOver25: 0.36,
  },
  {
    key: "gpl-bec-ber",
    competition: "Premier League",
    country: "Ghana",
    kickoffOffsetMin: -35, // already started
    names: { sportybet: ["Bechem United", "Berekum Chelsea"], betway: ["Bechem Utd", "Berekum Chelsea"] },
    odds1x2: [2.2, 2.95, 3.6],
    pOver25: 0.35,
  },
  {
    // Only listed on SportyBet: exercises "couldn't match this game" in Milestone 3.
    key: "gpl-nat-kar",
    competition: "Premier League",
    country: "Ghana",
    kickoffOffsetMin: 2 * DAY + 60,
    names: { sportybet: ["Nations FC", "Karela United"] },
    onlyOn: ["sportybet", "footballcom"],
    odds1x2: [1.85, 3.1, 4.7],
    pOver25: 0.37,
  },
];

// --- Odds derivation -------------------------------------------------------
// Turns fair probabilities into bookmaker odds with a margin, so every market is consistent.

function price(p: number, margin: number): number {
  return Math.max(1.01, Math.round((1 / (p * (1 + margin))) * 100) / 100);
}

export type MockPrices = {
  matchResult: [number, number, number];
  doubleChance: [number, number, number]; // 1X, 12, X2
  overUnder: Record<string, [number, number]>; // FT line → [over, under]
  firstHalfResult: [number, number, number];
  firstHalfOverUnder: Record<string, [number, number]>;
  btts: [number, number];
  handicap: Record<string, [number, number, number]>; // home line → [home, draw, away]
};

export function derivePrices(f: MockFixture, margin: number): MockPrices {
  const inv = f.odds1x2.map((o) => 1 / o);
  const sum = inv[0] + inv[1] + inv[2];
  const [ph, pd, pa] = inv.map((x) => x / sum);
  const two = (p: number): [number, number] => [price(p, margin), price(1 - p, margin)];

  const pO25 = f.pOver25;
  const pO15 = Math.min(0.92, pO25 + 0.2);
  const pO35 = Math.max(0.1, pO25 - 0.25);
  const pH1O05 = Math.min(0.85, pO25 + 0.12);
  const pH1O15 = Math.max(0.1, pO25 - 0.2);
  const pBtts = Math.min(0.75, Math.max(0.3, pO25 * 0.95 + 0.02 * (1 - Math.abs(ph - pa))));
  // Home -1: home must win by 2+. Home +1: home avoids losing by 2+.
  const pHomeBy2 = ph * 0.45;
  const pHomeBy1 = ph - pHomeBy2;
  const pAwayBy2 = pa * 0.45;
  const pAwayBy1 = pa - pAwayBy2;

  return {
    matchResult: [price(ph, margin), price(pd, margin), price(pa, margin)],
    doubleChance: [price(ph + pd, margin), price(ph + pa, margin), price(pd + pa, margin)],
    overUnder: { "1.5": two(pO15), "2.5": two(pO25), "3.5": two(pO35) },
    firstHalfResult: [price(ph * 0.8, margin), price(0.42, margin), price(pa * 0.8, margin)],
    firstHalfOverUnder: { "0.5": two(pH1O05), "1.5": two(pH1O15) },
    btts: two(pBtts),
    handicap: {
      "-1": [price(pHomeBy2, margin), price(pHomeBy1, margin), price(pd + pa, margin)],
      "1": [price(ph + pd, margin), price(pAwayBy1, margin), price(pAwayBy2, margin)],
    },
  };
}
