/**
 * The Betloy evaluation harness.
 *
 * Runs the eight cases in docs/provider-evaluation.md and judges each one on a readback, not on a
 * status code. Dry by default: it will not spend a credit without being told to, twice.
 *
 *   pnpm tsx scripts/provider-eval.ts                     # plan only, no network
 *   pnpm tsx scripts/provider-eval.ts --preflight         # free calls only (/bookmakers, /usage)
 *   pnpm tsx scripts/provider-eval.ts --test-mode         # ?test=true, mock data, no credits
 *   pnpm tsx scripts/provider-eval.ts --live --max-credits=8
 *
 * The key comes from BETLOY_API_KEY in the environment and is never printed, logged or written to
 * the report. Nothing here asks anyone to paste a secret anywhere.
 *
 * Why the gates are gates and not warnings: Betloy's own published terms disagree about whether a
 * free account can call the API at all. The pricing page lists "No API access" for the free plan;
 * the API page's rate-limit table gives Free 10 requests a minute and 1,000 a month. Both cannot
 * be true, and the difference between them is the difference between an evaluation that costs
 * nothing and one that needs a NGN 10,000/month subscription. So the harness refuses to spend
 * anything until the account's own /usage endpoint - which is free - says what the allowance is.
 */

import { createBetloyRoute, resolveEndpoint, type BetloyBookmaker } from "../lib/bookmakers/providers/betloy";
import type { RouteEndpoint } from "../lib/bookmakers/providers/types";

type Case = {
  n: number;
  from: RouteEndpoint;
  to: RouteEndpoint;
  /** A real booking code at `from`. Supplied by the operator; never invented here. */
  code?: string;
  asks: string;
  /** What has to be true to pass. */
  pass: string;
  /** Credits this case is expected to consume. */
  credits: number;
  /** Cases that deliberately reuse an earlier case's idempotency key. */
  repeatOf?: number;
};

/** The matrix from docs/provider-evaluation.md, as data. */
export const CASES: Case[] = [
  { n: 1, from: { brand: "MSport", country: "GH" }, to: { brand: "SportyBet", country: "GH" },
    asks: "Can a provider read a bookmaker Cloudflare refuses us?", credits: 1,
    pass: "Destination code reads back at SportyBet GH with the same legs" },
  { n: 2, from: { brand: "Betway", country: "GH" }, to: { brand: "SportyBet", country: "GH" },
    asks: "A second source we have no authorised route to", credits: 1,
    pass: "Destination code reads back with the same legs" },
  { n: 3, from: { brand: "betPawa", country: "GH" }, to: { brand: "SportyBet", country: "GH" },
    asks: "A third source we have no authorised route to", credits: 1,
    pass: "Destination code reads back with the same legs" },
  { n: 4, from: { brand: "1xBet", country: "GH" }, to: { brand: "SportyBet", country: "GH" },
    asks: "The family whose SaveCoupon refuses us with 161627", credits: 1,
    pass: "Destination code reads back with the same legs" },
  { n: 5, from: { brand: "SportyBet", country: "GH" }, to: { brand: "MSport", country: "GH" },
    asks: "Outbound from our own main source", credits: 1,
    pass: "Either a code that reads back, or an honest refusal. Documented either way" },
  { n: 6, from: { brand: "SportyBet", country: "GH" }, to: { brand: "SportyBet", country: "NG" },
    asks: "Does country survive, or does a GH slip become an NG code?", credits: 1,
    pass: "Refused, or a code whose legs carry Ghanaian prices" },
  { n: 7, from: { brand: "MSport", country: "GH" }, to: { brand: "SportyBet", country: "GH" },
    asks: "An expired or invalid code", credits: 1,
    pass: "A clear error. Never a code" },
  { n: 8, from: { brand: "MSport", country: "GH" }, to: { brand: "SportyBet", country: "GH" },
    asks: "Idempotency: the same intent sent twice", credits: 1, repeatOf: 1,
    pass: "Same result as case 1, and the allowance drops by at most one" },
];

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function plan(): void {
  const total = CASES.reduce((n, c) => n + c.credits, 0);
  console.log("\nBetloy evaluation plan\n" + "=".repeat(60));
  for (const c of CASES) {
    const repeat = c.repeatOf ? `  (repeats case ${c.repeatOf})` : "";
    console.log(
      `  ${c.n}. ${c.from.brand} ${c.from.country} -> ${c.to.brand} ${c.to.country}${repeat}\n` +
        `       asks: ${c.asks}\n       pass: ${c.pass}\n       credits: ${c.credits}`,
    );
  }
  console.log("-".repeat(60));
  console.log(`  Maximum credits this run would consume: ${total}`);
  console.log(`  Free calls used first and always: GET /bookmakers, GET /usage`);
  console.log(
    "\n  A case passes only when the destination code is read back through our own adapter\n" +
      "  and the legs match. A 200 is not a pass.\n",
  );
}

async function main(): Promise<void> {
  const keyPresent = (process.env.BETLOY_API_KEY ?? "").trim().length > 0;
  plan();

  console.log(`  API key in environment: ${keyPresent ? "present" : "ABSENT"}`);
  if (!keyPresent) {
    console.log(
      "\n  Nothing further can run. Set BETLOY_API_KEY in the environment of this shell.\n" +
        "  Do not paste it into a chat, a file in this repository, or a command that gets\n" +
        "  written to shell history.\n",
    );
    return;
  }

  const live = flag("live");
  const testMode = flag("test-mode");
  const preflight = flag("preflight") || live || testMode;
  if (!preflight) {
    console.log("\n  Plan only. Add --preflight for the free checks, or --live to spend credits.\n");
    return;
  }

  const route = createBetloyRoute({ testMode });

  // ---- free call 1: what does Betloy actually support, and in which region? ----
  let bookmakers: BetloyBookmaker[] = [];
  try {
    bookmakers = await route.listBookmakers();
    console.log(`\n  /bookmakers answered: ${bookmakers.length} entries (free call)`);
  } catch (err) {
    console.log(`\n  /bookmakers failed: ${(err as Error).message}`);
    console.log("  Stopping. Without the bookmaker list no route can be validated.\n");
    return;
  }

  // Every endpoint in the matrix must resolve to exactly one bookmaker in the right region.
  console.log("\n  Route validation, before any credit is spent:");
  const resolvable: number[] = [];
  for (const c of CASES) {
    const f = resolveEndpoint(bookmakers, c.from);
    const t = resolveEndpoint(bookmakers, c.to);
    const problems = [
      "error" in f ? `from: ${f.error}` : null,
      "error" in t ? `to: ${t.error}` : null,
    ].filter(Boolean);
    if (problems.length === 0) {
      resolvable.push(c.n);
      console.log(`    case ${c.n}: resolves`);
    } else {
      console.log(`    case ${c.n}: NOT RUNNABLE - ${problems.join("; ")}`);
    }
  }

  // ---- free call 2: the only authoritative statement of the allowance ----
  let usage: unknown;
  try {
    usage = await route.usage();
    console.log(`\n  /usage answered (free call): ${JSON.stringify(usage)}`);
  } catch (err) {
    console.log(`\n  /usage failed: ${(err as Error).message}`);
    console.log("  Stopping: the allowance cannot be confirmed, so nothing may be spent.\n");
    return;
  }

  if (!live) {
    console.log(
      `\n  Preflight complete. ${resolvable.length} of ${CASES.length} cases are runnable.\n` +
        "  No credits were used. Add --live --max-credits=N to proceed.\n",
    );
    return;
  }

  // ---- the gate ----
  const maxCredits = Number(arg("max-credits") ?? "0");
  const wanted = CASES.filter((c) => resolvable.includes(c.n)).reduce((n, c) => n + c.credits, 0);
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
    console.log("\n  --live needs --max-credits=N, stating what you are willing to spend.\n");
    return;
  }
  if (wanted > maxCredits) {
    console.log(
      `\n  Refusing to run: ${wanted} credits needed, --max-credits=${maxCredits}.\n` +
        "  Raise the limit deliberately or reduce the matrix.\n",
    );
    return;
  }

  console.log(
    "\n  Live running is gated here on purpose.\n" +
      "  Each case needs a real booking code at the source bookmaker, which this script does not\n" +
      "  and must not invent. Supply them, then re-run; the cases without a code are skipped.\n",
  );

  const withCodes = CASES.filter((c) => resolvable.includes(c.n) && c.code);
  if (withCodes.length === 0) {
    console.log("  No real source codes supplied. Nothing was sent and no credit was used.\n");
    return;
  }

  // Deliberately absent: the conversion loop and its readback.
  //
  // Writing it now would mean writing the pass/fail judgement against a response shape nobody has
  // seen - Betloy's published sample omits the `legs` and `flagged` arrays that its own FAQ and
  // SDK reference. The readback comparison is the entire test, and guessing at the field names it
  // compares would produce a harness that reports passes it has not checked.
  //
  // The free preflight above is what makes this safe to leave: it proves the key works, proves
  // each route resolves to the right region, and reads the real allowance - all without spending
  // anything. The remaining work is an hour against a live response, not a design problem.
  console.log("  Conversion loop not implemented: see the note in this file.\n");
}

main().catch((err) => {
  // Never print the error object wholesale: a thrown fetch error can carry request headers.
  console.error(`\n  Harness failed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
