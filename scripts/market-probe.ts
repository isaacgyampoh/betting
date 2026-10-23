/**
 * What markets the live bookmaker adapters actually return, for a real fixture.
 *
 * Read-only: it searches for a fixture and reads that fixture's markets. It never books, never
 * creates a code and never sends money anywhere. Run before building anything that claims to
 * analyse corners, cards, handicaps or player markets - the question "does SportyBet give us
 * corner lines for a Premier League game" has an answer, and it is not in any documentation.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/market-probe.ts [YYYY-MM-DD]
 *
 * Needs API_FOOTBALL_KEY, the adapters in live mode, **and a reachable Postgres**: both the stats
 * provider and the live adapters cache through `db.statsCache` (lib/bookmakers/live/cached-get.ts).
 * `gameclaw-db` permits no external connections, so this cannot be run from a laptop against
 * production - it has to run where the database is reachable, i.e. on Render, or against a local
 * Postgres with API_FOOTBALL_KEY set. Attempting it locally fails at the first cache write with
 * `tenant/user ... not found`, which is the dead Supabase URL in .env.local, not a bug here.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.SPORTYBET_MODE ??= "live";
process.env.FOOTBALLCOM_MODE ??= "live";

async function main() {
  const { connectedBookmakers } = await import("@/lib/bookmakers/registry");
  const { listMatches } = await import("@/lib/services/stats");

  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  function describe(market: { type: string; period: string; outcome: string; line: number | null } | null) {
    if (!market) return null;
    return `${market.type}${market.period && market.period !== "FULL_TIME" ? `/${market.period}` : ""}:${market.outcome}${market.line === null ? "" : ` ${market.line}`}`;
  }

  const day = await listMatches(date);
  // The biggest competitions first, which is the order listMatches already returns.
  const fixtures = day.groups.flatMap((g) => g.matches).filter((m) => m.status === "SCHEDULED").slice(0, 3);
  if (fixtures.length === 0) {
    console.log(`No scheduled fixtures on ${date}.`);
      return;
  }

  const live = connectedBookmakers().filter((b) => b.capabilities.events);
  console.log(`date ${date}  ·  adapters with event data: ${live.map((b) => b.slug).join(", ") || "none"}\n`);

  for (const fixture of fixtures) {
    console.log(`${fixture.home.name} v ${fixture.away.name}  (${fixture.league.country} ${fixture.league.name})`);
    for (const adapter of live) {
      try {
        const found = await adapter.searchEvent(fixture.home.name, fixture.away.name, new Date(fixture.kickoffAt));
        if (found.length === 0) {
          console.log(`  ${adapter.slug.padEnd(12)} fixture not listed`);
          continue;
        }
        const { offers } = await adapter.getEventMarkets(found[0].externalId);
        const modelled = new Map<string, number>();
        const unmodelled = new Map<string, number>();
        for (const o of offers) {
          const key = describe(o.market as never);
          if (key) modelled.set(key.split(":")[0], (modelled.get(key.split(":")[0]) ?? 0) + 1);
          else unmodelled.set(o.raw.marketName ?? o.raw.marketId, (unmodelled.get(o.raw.marketName ?? o.raw.marketId) ?? 0) + 1);
        }
        console.log(`  ${adapter.slug.padEnd(12)} ${offers.length} offers`);
        if (modelled.size) {
          console.log(`    modelled   ${[...modelled].map(([k, n]) => `${k}(${n})`).join(" ")}`);
        }
        if (unmodelled.size) {
          // These are the ones an engine would have to read raw, and the ones most likely to be
          // corners, cards and player markets.
          console.log(`    unmodelled ${[...unmodelled].slice(0, 14).map(([k, n]) => `${k}(${n})`).join(" ")}${unmodelled.size > 14 ? ` …+${unmodelled.size - 14}` : ""}`);
        }
      } catch (err) {
        console.log(`  ${adapter.slug.padEnd(12)} ERROR ${String(err).slice(0, 120)}`);
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
