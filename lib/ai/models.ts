// Models and prices used for AI features. Prices are USD per million tokens (Anthropic first-party rates).
export const CHAT_MODEL = process.env.AI_CHAT_MODEL || "claude-haiku-4-5";
export const ANALYSIS_MODEL = process.env.AI_ANALYSIS_MODEL || "claude-opus-5-5";

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** Estimated cost in micro-USD (1e-6 USD). $1 per million tokens = 1 micro-USD per token. */
export function costMicroUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return Math.round(u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite);
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export function supportsServerFallback(model: string) {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}
