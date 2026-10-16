#!/usr/bin/env node
/**
 * What the football provider actually gives us, competition by competition.
 *
 * Reads API-Football's own per-season coverage flags for the competitions GameClaw ranks, so the
 * gaps are facts the provider published rather than guesses. Run it when deciding what a screen
 * may promise:
 *
 *   node scripts/coverage-report.mjs            # the ranked competitions
 *   node scripts/coverage-report.mjs --all      # every competition with a current season
 *
 * Needs API_FOOTBALL_KEY in .env.local. Prints no key and writes nothing.
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const KEY = env.API_FOOTBALL_KEY;
if (!KEY) { console.error("Set API_FOOTBALL_KEY in .env.local"); process.exit(1); }

// Kept in step with PRIORITY in lib/services/stats.ts.
const src = readFileSync(new URL("../lib/services/stats.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf("const PRIORITY"), src.indexOf("];", src.indexOf("const PRIORITY")));
const ranked = [...block.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((m) => `${m[1]}||${m[2]}`);

const res = await fetch("https://v3.football.api-sports.io/leagues", { headers: { "x-apisports-key": KEY } });
const { response } = await res.json();

const all = process.argv.includes("--all");
const rows = [];
for (const L of response) {
  const key = `${L.country.name}||${L.league.name}`;
  const rank = ranked.indexOf(key);
  if (!all && rank === -1) continue;
  const season = L.seasons?.find((s) => s.current) ?? L.seasons?.at(-1);
  if (!season) continue;
  const f = season.coverage?.fixtures ?? {};
  rows.push({
    rank: rank === -1 ? 999 : rank,
    name: `${L.country.name} · ${L.league.name}`,
    season: season.year,
    events: !!f.events,
    lineups: !!f.lineups,
    stats: !!f.statistics_fixtures,
    players: !!f.statistics_players,
    table: !!season.coverage?.standings,
    odds: !!season.coverage?.odds,
  });
}
rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

const tick = (b) => (b ? "yes" : " - ");
console.log(`\n${rows.length} competitions\n`);
console.log("    competition                                   season  timeline lineups  stats  players  table   odds");
console.log("    " + "-".repeat(104));
for (const r of rows) {
  console.log(
    `    ${r.name.slice(0, 44).padEnd(44)}  ${String(r.season).padEnd(6)}  ` +
    `${tick(r.events).padEnd(8)} ${tick(r.lineups).padEnd(8)} ${tick(r.stats).padEnd(6)} ` +
    `${tick(r.players).padEnd(8)} ${tick(r.table).padEnd(7)} ${tick(r.odds)}`,
  );
}
const pct = (k) => `${Math.round((rows.filter((r) => r[k]).length / rows.length) * 100)}%`;
console.log(`\n    of these: timeline ${pct("events")}, lineups ${pct("lineups")}, ` +
            `match stats ${pct("stats")}, player stats ${pct("players")}, table ${pct("table")}, odds ${pct("odds")}`);
console.log("\n    A competition that does not carry a section is told to the user as such; nothing is");
console.log("    estimated to fill a gap, and a missing value is never rendered as a zero.\n");
