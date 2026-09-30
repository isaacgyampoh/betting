import { totalOdds } from "@/lib/slips/view";

// Slip editing operations. Pure and client-safe: the UI previews with these,
// and the server re-runs them before booking so results always match the preview.

export type EditItem = { position: number; odds: number | null };

export type EditOp =
  | { type: "remove"; positions: number[] }
  | { type: "safest"; count: number }
  | { type: "trim"; targetOdds: number }
  | { type: "split"; parts: number };

export type EditResult = { groups: number[][]; totals: (number | null)[] };

const byOddsAsc = (a: EditItem, b: EditItem) => (a.odds ?? Infinity) - (b.odds ?? Infinity) || a.position - b.position;
const inOriginalOrder = (positions: number[]) => [...positions].sort((a, b) => a - b);

/** Drop the given games. */
export function removeGames(items: EditItem[], positions: number[]): number[] {
  const drop = new Set(positions);
  return items.filter((i) => !drop.has(i.position)).map((i) => i.position);
}

/** Keep the N safest picks (lowest odds = highest implied probability). */
export function keepSafest(items: EditItem[], count: number): number[] {
  return inOriginalOrder([...items].sort(byOddsAsc).slice(0, Math.max(0, count)).map((i) => i.position));
}

/**
 * Remove the riskiest picks (highest odds first) until total odds are at or below the target.
 * Equivalent to keeping the longest safest-first run whose product fits under the target.
 */
export function trimToOdds(items: EditItem[], target: number): number[] {
  const kept: number[] = [];
  let product = 1;
  for (const item of [...items].sort(byOddsAsc)) {
    const odds = item.odds ?? 1;
    if (product * odds > target + 1e-9) break;
    product *= odds;
    kept.push(item.position);
  }
  return inOriginalOrder(kept);
}

/** Split into N slips with balanced total odds (greedy: biggest odds to the smallest slip, in log space). */
export function splitSlip(items: EditItem[], parts: number): number[][] {
  const n = Math.max(1, Math.min(parts, items.length));
  const groups: { positions: number[]; logOdds: number }[] = Array.from({ length: n }, () => ({ positions: [], logOdds: 0 }));
  for (const item of [...items].sort((a, b) => byOddsAsc(b, a))) {
    const target = groups.reduce((min, g) =>
      g.positions.length < min.positions.length || (g.positions.length === min.positions.length && g.logOdds < min.logOdds) ? g : min,
    );
    target.positions.push(item.position);
    target.logOdds += Math.log(item.odds ?? 1);
  }
  return groups.map((g) => inOriginalOrder(g.positions)).filter((g) => g.length > 0);
}

export function applyEdit(items: EditItem[], op: EditOp): EditResult {
  const groups =
    op.type === "remove"
      ? [removeGames(items, op.positions)]
      : op.type === "safest"
        ? [keepSafest(items, op.count)]
        : op.type === "trim"
          ? [trimToOdds(items, op.targetOdds)]
          : splitSlip(items, op.parts);
  const oddsOf = new Map(items.map((i) => [i.position, i.odds]));
  return { groups, totals: groups.map((g) => totalOdds(g.map((p) => oddsOf.get(p) ?? null))) };
}
