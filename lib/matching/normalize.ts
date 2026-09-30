// Team-name normalization for cross-bookmaker matching. Milestone 3 adds aliases + fuzzy scoring.
const NOISE_TOKENS = new Set(["fc", "sc", "afc", "cf", "ac", "ssc", "cd", "club", "the"]);

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE_TOKENS.has(t))
    .join(" ");
}
