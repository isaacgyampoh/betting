// Team-name normalization for cross-bookmaker matching. Milestone 3 adds aliases + fuzzy scoring.
const NOISE_TOKENS = new Set(["fc", "sc", "afc", "cf", "ac", "ssc", "cd", "club", "the"]);

/**
 * Markers that mean the same squad written differently. Feeds disagree on these — one writes
 * "Arsenal W", another "Arsenal Women" — and without folding them together the two score as
 * different teams and a women's fixture never matches its own stats.
 */
const SYNONYMS: Record<string, string> = {
  women: "w",
  womens: "w",
  ladies: "w",
  feminine: "w",
  feminin: "w",
  femenino: "w",
  frauen: "w",
  dames: "w",
  reserve: "reserves",
  jr: "junior",
};

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE_TOKENS.has(t))
    .map((t) => SYNONYMS[t] ?? t)
    .join(" ");
}
