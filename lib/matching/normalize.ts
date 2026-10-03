// Team-name normalization for cross-bookmaker matching. Milestone 3 adds aliases + fuzzy scoring.

/**
 * Club-type markers that carry no information about which club it is: one feed writes "AD Pasto"
 * and another "Deportivo Pasto", one "Hamburger SV" and another "Hamburg".
 *
 * Added only where the rest of the name still identifies the club on its own. "CP" is deliberately
 * absent: dropping it would leave Sporting CP as plain "Sporting", a token that several clubs have
 * all of, and quoting the wrong club's results is worse than finding none.
 */
const NOISE_TOKENS = new Set([
  "fc", "sc", "afc", "cf", "ac", "ssc", "cd", "club", "the",
  "ca", "ad", "cs", "rc", "sd", "ue", "se", "as", "ss", "ec", "aa",
  "sv", "bv", "bsc", "vfb", "vfl", "fsv", "tsg", "tsv",
]);

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
  const tokens = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return joinInitials(tokens)
    .filter((t) => !NOISE_TOKENS.has(t))
    .map((t) => SYNONYMS[t] ?? t)
    .join(" ");
}

/**
 * Puts an initialism back together after the punctuation that held it has been stripped.
 * "Virgin Islands, U.S." becomes "virgin islands u s" and so no longer looks anything like
 * "US Virgin Islands"; this makes it "virgin islands us". Only runs of two or more single letters
 * are joined, so a lone squad marker - the "W" of "Arsenal W" - is left exactly where it is.
 */
function joinInitials(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let j = i;
    while (j < tokens.length && /^[a-z]$/.test(tokens[j])) j++;
    if (j - i >= 2) {
      out.push(tokens.slice(i, j).join(""));
      i = j;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out;
}
