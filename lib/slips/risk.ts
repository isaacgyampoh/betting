// Risk score for a slip. Pure and client-safe, so the same numbers appear in the UI and the API.
//
// Risk here means "how unlikely is it that every pick lands", which is mostly a function of the
// prices and how many games are on the slip. It's an estimate from the numbers we hold, not a
// judgement about which teams are good.

import { impliedProbability } from "@/lib/slips/target-odds";

export type RiskItem = { position: number; odds: number | null; started?: boolean };

export type RiskLevel = "low" | "medium" | "high";

export type SlipRisk = {
  level: RiskLevel;
  /** Estimated chance every pick lands, 0..1. */
  probability: number;
  /** The games dragging the slip down most, worst first. */
  riskiest: { position: number; odds: number; probability: number; reason: string }[];
  /** Short, plain-language summary. */
  summary: string;
};

/** A single pick this unlikely is treated as the risky end, whatever the rest of the slip does. */
const RISKY_PICK_PROBABILITY = 0.5;

export function slipRisk(items: RiskItem[]): SlipRisk {
  const priced = items.filter((i): i is RiskItem & { odds: number } => typeof i.odds === "number" && i.odds > 1);
  if (!priced.length) {
    return { level: "medium", probability: 0, riskiest: [], summary: "We don't have prices for this slip, so we can't estimate its risk." };
  }

  const scored = priced
    .map((i) => ({ position: i.position, odds: i.odds, probability: impliedProbability(i.odds), started: i.started === true }))
    .sort((a, b) => a.probability - b.probability);

  const probability = scored.reduce((p, s) => p * s.probability, 1);
  const level: RiskLevel = probability >= 0.4 ? "low" : probability >= 0.15 ? "medium" : "high";

  const riskiest = scored
    .filter((s) => s.probability < RISKY_PICK_PROBABILITY || s.started)
    .slice(0, 3)
    .map((s) => ({
      position: s.position,
      odds: s.odds,
      probability: s.probability,
      reason: s.started
        ? "This game has already started, so the bookmaker may void it."
        : `At ${s.odds.toFixed(2)}, this is about a ${Math.round(s.probability * 100)}% chance on its own.`,
    }));

  const games = scored.length;
  const summary =
    level === "low"
      ? `${games} ${games === 1 ? "pick" : "picks"}, mostly short prices. Around a ${Math.round(probability * 100)}% chance all of them land.`
      : level === "medium"
        ? `${games} picks with a mix of prices. Around a ${Math.round(probability * 100)}% chance all of them land.`
        : `${games} picks, several of them long shots. Under a ${Math.max(1, Math.round(probability * 100))}% chance all of them land.`;

  return { level, probability, riskiest, summary };
}
