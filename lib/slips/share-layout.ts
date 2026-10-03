import { formatKickoff } from "@/lib/format";

// Laying out a share image is laying out something that cannot be measured afterwards: whatever
// is drawn past the canvas is cut off, footer and all. These helpers estimate before drawing.

/**
 * Keep a reason inside the room a row has for it. About 78 characters fit on a 740px line at
 * 19px, so the budget is lines x 78. Over that we cut back to the last full sentence, and only
 * fall back to a word boundary when the first sentence is itself too long: "...at about ..." is a
 * worse read than a shorter explanation that finishes its thought.
 */
export function trimToLines(text: string, lines: number) {
  const max = lines * 78;
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (sentence > max * 0.4) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).replace(/[,.;:]$/, "")}\u2026`;
}

/**
 * Roughly how tall a run of text is once it wraps: characters per line, then lines times leading.
 * The numbers at the call site were read off rendered images rather than reasoned about - satori
 * leads at about 1.4, and a 30px line in 760px takes about 45 characters.
 */
const wrapped = (text: string, perLine: number, leading: number) => Math.max(1, Math.ceil(text.length / perLine)) * leading;

type Game = { home: string; away: string; pickLabel: string; kickoffAt: string; reason?: string | null };

/**
 * Choose how many games to show, how much of each reason, and the row padding, so the list fills
 * the canvas without running off it. Reasons are shortened before games are dropped - a shorter
 * explanation still explains, whereas a dropped game is gone - and the padding is set from what
 * the rows actually come to, so a short slip spreads out instead of sitting on top of the footer.
 */
export function fitShareList<T extends Game>(playable: T[], free: number) {
  const explained = playable.some((g) => g.reason);
  const height = (games: T[], reasons: (string | null)[]) =>
    games.reduce(
      (h, g, i) =>
        h +
        1 +
        wrapped(`${g.home} v ${g.away}`, 45, 42) +
        wrapped(`${g.pickLabel} - ${formatKickoff(g.kickoffAt)}`, 68, 31) +
        (reasons[i] ? 6 + wrapped(reasons[i]!, 78, 27) : 0),
      0,
    );

  let count = Math.min(playable.length, explained ? 6 : 10);
  let lines = 4;
  let games = playable.slice(0, count);
  let reasons = games.map((g) => (g.reason ? trimToLines(g.reason, lines) : null));

  // 36 is the floor: two rows of padding at 18 each, the tightest the rows are allowed to sit.
  while (height(games, reasons) + 36 * count > free) {
    if (lines > 1) lines -= 1;
    else if (count > 3) count -= 1;
    else break;
    games = playable.slice(0, count);
    reasons = games.map((g) => (g.reason ? trimToLines(g.reason, lines) : null));
  }

  const slack = free - height(games, reasons);
  const pad = Math.max(18, Math.min(44, Math.floor(slack / (2 * Math.max(count, 1)))));
  return { games, reasons, pad };
}
