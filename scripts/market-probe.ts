/**
 * What markets the live bookmaker adapters actually return, for a real fixture.
 *
 * Read-only: it searches for a fixture and reads that fixture's markets. It never books, never
 * creates a code and never spends anything. Run before building anything that claims to analyse
 * corners, cards, handicaps or player markets - "does SportyBet give us corner lines for a
 * Premier League game" has an answer, and it is not in any documentation.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/market-probe.ts [YYYY-MM-DD]
 *
 * Fixtures come from the deployed API over HTTP, not from `listMatches`: the stats provider caches
 * through `db.statsCache` unguarded, and `gameclaw-db` takes no external connections, so calling it
 * from a laptop dies on the first cache write. The bookmaker adapters have no such problem - their
 * cache is explicitly "an optimisation, never a dependency" and both sides are try/caught - so they
 * run here perfectly well, just without a cache.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

// Forced, not defaulted. `.env.local` sets SPORTYBET_MODE=mock for local development, so `??=`
// silently left the mock adapter in place and the probe measured a fixture generator instead of
// a bookmaker - reporting that SportyBet carried none of today's Premier League games, which was
// false and would have sent someone hunting a production bug that does not exist.
for (const k of ["SPORTYBET_MODE", "FOOTBALLCOM_MODE", "MSPORT_MODE", "BETWAY_MODE"]) {
  process.env[k] = "live";
}

const API = process.env.GC_API_BASE ?? "https://gameclaw-api.onrender.com/api/v1";

type Fixture = {
  id: number;
  kickoffAt: string;
  status: string;
  league: { name: string; country: string };
  home: { name: string };
  away: { name: string };
};

async function main() {
  const { connectedBookmakers } = await import("@/lib/bookmakers/registry");
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  const res = await fetch(`${API}/matches?date=${date}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`fixtures: HTTP ${res.status}`);
  const body = (await res.json()) as { data: { groups: { matches: Fixture[] }[] } };
  const fixtures = body.data.groups
    .flatMap((g) => g.matches)
    .filter((m) => m.status === "SCHEDULED")
    .slice(0, Number(process.env.N ?? 1));

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
        const raw = new Map<string, number>();
        for (const o of offers) {
          if (o.market) modelled.set(o.market.type, (modelled.get(o.market.type) ?? 0) + 1);
          else {
            const name = o.raw.marketName ?? `id:${o.raw.marketId}`;
            raw.set(name, (raw.get(name) ?? 0) + 1);
          }
        }
        console.log(`  ${adapter.slug.padEnd(12)} ${offers.length} offers`);
        if (modelled.size) console.log(`    modelled  ${[...modelled].map(([k, n]) => `${k}(${n})`).join(" ")}`);
        if (raw.size) {
          // These are the ones an engine would have to read raw, and where corners, cards and
          // player markets are if they are offered at all. Printed in full rather than sampled:
          // the whole point of running this is to find out what is in the long tail.
          console.log(`    raw (${raw.size} distinct)`);
          for (const [name, n] of [...raw].sort((a, b) => b[1] - a[1])) {
            console.log(`      ${String(n).padStart(3)}  ${name}`);
          }
        }
      } catch (err) {
        console.log(`  ${adapter.slug.padEnd(12)} ERROR ${String(err).slice(0, 140)}`);
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
