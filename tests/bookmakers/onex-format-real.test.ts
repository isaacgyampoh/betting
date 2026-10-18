import { beforeAll, describe, expect, it } from "vitest";
import { ONEX_GROUP_TYPES, onexFormat } from "@/lib/bookmakers/formats/onex-format";

// The 1xBet platform ships no labels, so its market mapping cannot be read off a response the way
// SportyBet's can — it was derived from the platform's own group table and then corroborated against
// a bookmaker that does label its data. This re-checks that derivation against live data, so the
// mapping cannot drift unnoticed. Read-only: it fetches two public feeds and compares them.
//
//   VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/onex-format-real.test.ts

const live = process.env.VERIFY_LIVE === "1";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

type Bet = { T: number; C: number; G: number; P?: number };

async function onexGame(constId: number) {
  const url = `https://1xbet.com.gh/service-api/LineFeed/GetGameZip?id=${constId}&lng=en&cfView=0&isSubGames=true&GroupEvents=true`;
  const res = await fetch(url, { headers: { "user-agent": UA, referer: "https://1xbet.com.gh/en" } });
  const body = (await res.json()) as { Value?: { E?: Bet[]; O1?: string; O2?: string } };
  return body.Value ?? {};
}

/**
 * A fixture on the board right now that carries a deep market list.
 *
 * This file used to pin one `constId` - Germany v Serbia - and the comment next to it already
 * said any well-covered fixture would do. It stopped doing: the match is long played, GetGameZip
 * returns nothing for it, and two tests failed asserting that 0 > 100. Nothing about the mapping
 * had drifted, which is the one thing this file exists to detect, so the failure was pure noise.
 *
 * Resolved from the listing feed instead, picking the best-covered of the first few candidates.
 * `CI` is the constant id GetGameZip takes.
 */
async function wellCoveredGame(): Promise<{ id: number; bets: Bet[] }> {
  const url = "https://1xbet.com.gh/service-api/LineFeed/Get1x2_VZip?sports=1&count=40&lng=en&mode=4";
  const res = await fetch(url, { headers: { "user-agent": UA, referer: "https://1xbet.com.gh/en" } });
  const body = (await res.json()) as { Value?: { CI?: number; I?: number }[] };
  const ids = (body.Value ?? []).map((g) => Number(g.CI ?? g.I)).filter((n) => Number.isFinite(n));

  let best: { id: number; bets: Bet[] } = { id: 0, bets: [] };
  for (const id of ids.slice(0, 12)) {
    const bets = (await onexGame(id)).E ?? [];
    if (bets.length > best.bets.length) best = { id, bets };
    // Deep enough to exercise every group this file checks; no need to keep fetching.
    if (best.bets.length > 150) break;
  }
  return best;
}

describe.skipIf(!live)("1xBet market mapping, against live data", () => {
  let game: { id: number; bets: Bet[] };

  beforeAll(async () => {
    game = await wellCoveredGame();
  }, 120_000);

  it("every declared group really carries the outcome types we expect", async () => {
    const bets = game.bets;
    expect(bets.length, `best-covered fixture was ${game.id}`).toBeGreaterThan(100);

    for (const [groupId, types] of Object.entries(ONEX_GROUP_TYPES)) {
      const g = Number(groupId.slice(1));
      const seen = new Set(bets.filter((b) => b.G === g).map((b) => b.T));
      if (!seen.size) continue; // not offered on this fixture
      // No stray types in a group we claim to understand.
      for (const t of seen) expect(types, `G${g} carried unexpected T${t}`).toContain(t);
    }
  }, 60_000);

  it("maps and round-trips the markets it claims", async () => {
    const bets = game.bets;
    const mapped = bets
      .map((b) => ({ b, raw: { marketId: `G${b.G}`, outcomeId: `T${b.T}`, specifier: b.P === undefined ? "" : `P=${b.P}` } }))
      .map((x) => ({ ...x, market: onexFormat.mapMarket(x.raw) }))
      .filter((x) => x.market);

    expect(mapped.length).toBeGreaterThan(20);
    for (const { raw, market } of mapped) {
      const back = onexFormat.unmapMarket(market!);
      expect(back, JSON.stringify(raw)).not.toBeNull();
      expect({ marketId: back!.marketId, outcomeId: back!.outcomeId, specifier: back!.specifier }).toEqual(raw);
    }
  }, 60_000);

  it("reads an away asian handicap as the same bet as the home side's", async () => {
    const bets = game.bets.filter((b) => b.G === 2);
    const home = bets.find((b) => b.T === 7 && b.P === -2);
    const away = bets.find((b) => b.T === 8 && b.P === 2);
    if (!home || !away) return; // this line not offered right now

    // 1xBet writes the line from each side's own perspective; ours is always home-relative, so both
    // must come back as line -2. Getting this wrong would book the opposite handicap.
    const hm = onexFormat.mapMarket({ marketId: "G2", outcomeId: "T7", specifier: "P=-2" })!;
    const am = onexFormat.mapMarket({ marketId: "G2", outcomeId: "T8", specifier: "P=2" })!;
    expect(hm).toEqual({ type: "ASIAN_HANDICAP", period: "FT", outcome: "HOME", line: -2 });
    expect(am).toEqual({ type: "ASIAN_HANDICAP", period: "FT", outcome: "AWAY", line: -2 });
  }, 60_000);

  it("still refuses the markets it has never verified", () => {
    // Over 200 groups exist on one fixture; anything unchecked must map to null, not a guess.
    for (const raw of [
      { marketId: "G19", outcomeId: "T180", specifier: "" },
      { marketId: "G27", outcomeId: "T424", specifier: "P=1" },
      { marketId: "G9423", outcomeId: "T10328", specifier: "" },
    ]) {
      expect(onexFormat.mapMarket(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});
