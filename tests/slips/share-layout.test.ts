import { describe, expect, it } from "vitest";
import { fitShareList, trimToLines } from "@/lib/slips/share-layout";

// The share image is 1080x1350 with no scrolling and no measuring step: anything laid out past the
// bottom is cut off, taking the footer and the responsible-gambling line with it. These are the
// numbers the route passes, so a regression here is a regression in what people actually share.
const FREE = 1350 - 320;

const game = (over: Partial<Parameters<typeof fitShareList>[0][number]> = {}) => ({
  home: "Arsenal",
  away: "Chelsea",
  pickLabel: "Over 2.5 goals",
  kickoffAt: "2026-10-04T15:00:00.000Z",
  reason: null as string | null,
  ...over,
});

// Mirrors the estimate inside fitShareList: if the two ever disagree, this test is the one that
// is wrong, but it keeps the fit honest about the thing it is fitting.
const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));
function heightOf(result: ReturnType<typeof fitShareList>) {
  return result.games.reduce((h, g, i) => {
    const reason = result.reasons[i];
    return (
      h +
      1 +
      2 * result.pad +
      lines(`${g.home} v ${g.away}`, 45) * 42 +
      lines(`${g.pickLabel} - Sun 4 Oct, 15:00 GMT`, 68) * 31 +
      (reason ? 6 + lines(reason, 78) * 27 : 0)
    );
  }, 0);
}

describe("trimToLines", () => {
  it("leaves a reason that fits alone", () => {
    const text = "Guyana won in 5 of 5 at home.";
    expect(trimToLines(text, 2)).toBe(text);
  });

  it("keeps a whole sentence when one gets close to filling the room", () => {
    const text =
      "SportyBet make this the likeliest result in the J2 League, at about 72%. We couldn't pull recent form for this game, so this rests on the bookmaker's price alone, which is thinner evidence than we like.";
    const out = trimToLines(text, 2);
    expect(out.length).toBeLessThanOrEqual(156);
    expect(out.endsWith(".")).toBe(true);
    expect(out).not.toContain("\u2026");
    expect(text.startsWith(out)).toBe(true);
  });

  it("would rather cut at a word than throw away most of the room for a short first sentence", () => {
    const text =
      "Both teams scored in 7 of Germany's last 10. SportyBet price both teams scoring at about 59%, and the two sides have traded goals in each of their last three meetings, which is why this is on the slip rather than a straight win.";
    const out = trimToLines(text, 2);
    expect(out.length).toBeGreaterThan(120); // not cut back to the 44-character first sentence
    expect(out.endsWith("\u2026")).toBe(true);
    expect(text.startsWith(out.slice(0, -1))).toBe(true); // a word boundary, not mid-word
    expect(text[out.length - 1]).toBe(" ");
  });

  it("falls back to a word boundary when the first sentence is itself too long", () => {
    const text = `${"word ".repeat(40)}end.`;
    const out = trimToLines(text, 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/); // never mid-word
  });
});

describe("fitShareList", () => {
  it("fits nine short games and says how many were left out", () => {
    const { games, pad } = fitShareList(Array.from({ length: 12 }, () => game()), FREE);
    expect(games.length).toBe(9);
    expect(pad).toBeGreaterThanOrEqual(18);
    expect(heightOf({ games, reasons: games.map(() => null), pad })).toBeLessThanOrEqual(FREE);
  });

  it("drops games rather than clipping when the names wrap to two lines", () => {
    const long = () => game({ home: "Wolverhampton Wanderers", away: "Brighton and Hove Albion" });
    const result = fitShareList(Array.from({ length: 12 }, long), FREE);
    expect(result.games.length).toBeLessThan(9);
    expect(heightOf(result)).toBeLessThanOrEqual(FREE);
  });

  it("shortens reasons before it drops a game", () => {
    const reason =
      "Both teams scored in 7 of their last 10 and in 8 of the away side's. The bookmaker prices both teams scoring at about 59%, and the two have traded goals in each of their last three meetings, so this is the market rather than a straight win.";
    const result = fitShareList(Array.from({ length: 6 }, () => game({ reason })), FREE);
    expect(result.games.length).toBe(6);
    expect(result.reasons.every((r) => r && r.length < reason.length)).toBe(true);
    expect(heightOf(result)).toBeLessThanOrEqual(FREE);
  });

  it("spreads a short slip out instead of leaving it on top of the footer", () => {
    const tight = fitShareList(Array.from({ length: 9 }, () => game()), FREE);
    const roomy = fitShareList([game(), game(), game()], FREE);
    expect(roomy.pad).toBeGreaterThan(tight.pad);
    expect(heightOf(roomy)).toBeLessThanOrEqual(FREE);
  });

  it("keeps at least three games, even when every one of them is huge", () => {
    const huge = () =>
      game({
        home: "A very long home side name indeed".repeat(2),
        away: "An equally long away side name".repeat(2),
        reason: "x".repeat(400),
      });
    const result = fitShareList(Array.from({ length: 8 }, huge), FREE);
    expect(result.games.length).toBeGreaterThanOrEqual(3);
    expect(heightOf(result)).toBeLessThanOrEqual(FREE);
  });

  it("handles a slip with nothing playable on it", () => {
    expect(fitShareList([], FREE)).toMatchObject({ games: [], reasons: [] });
  });
});
