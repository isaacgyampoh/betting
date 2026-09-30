import { ALIAS_GROUPS } from "@/lib/matching/aliases";
import { normalizeTeamName } from "@/lib/matching/normalize";

// Abbreviations bookmakers use; expanded before token comparison.
const TOKEN_EXPANSIONS: Record<string, string> = {
  utd: "united",
  man: "manchester",
  nottm: "nottingham",
  atl: "atletico",
  st: "saint",
  wand: "wanderers",
};

export type AliasIndex = Map<string, string>; // normalized alias → group key

export function buildAliasIndex(extra: { alias: string; canonical: string }[] = []): AliasIndex {
  const index: AliasIndex = new Map();
  for (const group of ALIAS_GROUPS) {
    const key = normalizeTeamName(group[0]);
    for (const name of group) index.set(normalizeTeamName(name), key);
  }
  for (const { alias, canonical } of extra) {
    const key = index.get(normalizeTeamName(canonical)) ?? normalizeTeamName(canonical);
    index.set(normalizeTeamName(alias), key);
  }
  return index;
}

const DEFAULT_INDEX = buildAliasIndex();

function tokens(normalized: string): string[] {
  return normalized.split(" ").map((t) => TOKEN_EXPANSIONS[t] ?? t);
}

/** Jaro–Winkler similarity (0..1), good for short names with typos/abbreviations. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k++]) t++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Token-level fuzzy overlap: each token scores its best Jaro–Winkler match on the other side
 * (below 0.88 counts as 0), averaged both ways. "Manchester United" vs "Manchester City" → 0.5,
 * because the distinguishing tokens don't match, while typos like "Tottenhm" still score high.
 */
function softTokenScore(a: string[], b: string[]): number {
  const side = (x: string[], y: string[]) =>
    x.reduce((sum, t) => {
      const best = Math.max(...y.map((u) => jaroWinkler(t, u)));
      return sum + (best >= 0.88 ? best : 0);
    }, 0) / x.length;
  return (side(a, b) + side(b, a)) / 2;
}

/** 0..1 confidence that two team names refer to the same club. */
export function teamSimilarity(a: string, b: string, index: AliasIndex = DEFAULT_INDEX): number {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ka = index.get(na);
  const kb = index.get(nb);
  if (ka && ka === kb) return 0.98;
  // Both are known clubs, and different ones ("Inter Milan" vs "Milan").
  if (ka && kb) return 0.1;

  const ta = tokens(na);
  const tb = tokens(nb);
  if (ta.join(" ") === tb.join(" ")) return 0.97;

  const setA = new Set(ta);
  const setB = new Set(tb);
  const common = [...setA].filter((t) => setB.has(t)).length;
  const jaccard = common / new Set([...setA, ...setB]).size;
  // "Newcastle" vs "Newcastle United": every token of the shorter name appears in the longer one.
  const contained = common > 0 && common === Math.min(setA.size, setB.size) ? 0.88 : 0;
  return Math.max(jaccard, contained, softTokenScore(ta, tb));
}

export type FixtureRef = { home: string; away: string; kickoffAt: Date };

export const KICKOFF_TOLERANCE_MS = 15 * 60_000;
export const MATCH_THRESHOLD = 0.8;

/** Picks the candidate that best matches the fixture (both teams, kickoff ±15 min). */
export function bestMatch<T extends FixtureRef>(
  source: FixtureRef,
  candidates: T[],
  index: AliasIndex = DEFAULT_INDEX,
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null;
  for (const c of candidates) {
    if (Math.abs(c.kickoffAt.getTime() - source.kickoffAt.getTime()) > KICKOFF_TOLERANCE_MS) continue;
    const score = Math.min(teamSimilarity(source.home, c.home, index), teamSimilarity(source.away, c.away, index));
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { candidate: c, score };
  }
  return best;
}
